import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { google } from "googleapis";
import { env, isConfigured } from "./config.js";
import { store } from "./store.js";

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

export function redirectUri(req) {
  if (env.googleRedirectUri) return env.googleRedirectUri;
  const proto = req?.protocol || "http";
  const host = req?.get?.("host") || `localhost:${env.port}`;
  return `${proto}://${host}/api/google/callback`;
}

export function clientConfigured() {
  return isConfigured;
}

export function connected() {
  return Boolean(store.state.google?.tokens?.refresh_token);
}

function newOAuthClient(req) {
  return new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    redirectUri(req),
  );
}

export function authUrl(req, state) {
  const client = newOAuthClient(req);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: SCOPES,
    state,
  });
}

export async function exchangeCode(req, code) {
  const client = newOAuthClient(req);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  let channel = null;
  try {
    const youtube = google.youtube({ version: "v3", auth: client });
    const res = await youtube.channels.list({ part: "snippet,statistics", mine: true });
    const item = res.data.items?.[0];
    if (item) {
      channel = {
        id: item.id,
        title: item.snippet?.title || "",
        thumbnail: item.snippet?.thumbnails?.default?.url || "",
        subscribers: item.statistics?.subscriberCount || null,
        videos: item.statistics?.videoCount || null,
      };
    }
  } catch (error) {
    console.warn("[google] channel info nahi mila:", error.message);
  }

  store.state.google = {
    channel,
    connectedAt: new Date().toISOString(),
    tokens: {
      access_token: tokens.access_token || null,
      refresh_token: tokens.refresh_token || store.state.google?.tokens?.refresh_token || null,
      expiry_date: tokens.expiry_date || null,
      scope: tokens.scope || SCOPES.join(" "),
      token_type: tokens.token_type || "Bearer",
    },
  };
  store.save();
  return store.state.google;
}

export function disconnect() {
  store.state.google = null;
  store.save();
}

function authorizedClient() {
  if (!connected()) throw new Error("Pehle YouTube channel connect karo.");
  const client = newOAuthClient();
  client.setCredentials(store.state.google.tokens);
  client.on("tokens", (tokens) => {
    const current = store.state.google?.tokens || {};
    store.state.google.tokens = {
      ...current,
      ...tokens,
      refresh_token: tokens.refresh_token || current.refresh_token,
    };
    store.save();
  });
  return client;
}

function youtubeClient() {
  if (connected()) return google.youtube({ version: "v3", auth: authorizedClient() });
  if (env.googleApiKey) return google.youtube({ version: "v3", auth: env.googleApiKey });
  return null;
}

function driveClient() {
  if (connected()) return google.drive({ version: "v3", auth: authorizedClient() });
  if (env.googleApiKey) return google.drive({ version: "v3", auth: env.googleApiKey });
  throw new Error("Drive ke liye YouTube connect karo ya GOOGLE_API_KEY set karo.");
}

/* ---------------------------------- Drive --------------------------------- */

export async function getFileMeta(fileId) {
  const drive = driveClient();
  const res = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size,trashed,videoMediaMetadata(durationMillis),thumbnailLink",
    supportsAllDrives: true,
  });
  return res.data;
}

export async function listFolderVideos(folderId) {
  const drive = driveClient();
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'video/'`,
      fields:
        "nextPageToken, files(id,name,mimeType,size,videoMediaMetadata(durationMillis))",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      orderBy: "name",
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return files;
}

export async function downloadFile(fileId, destination) {
  const drive = driveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" },
  );
  await pipeline(res.data, fs.createWriteStream(destination));
  const size = fs.statSync(destination).size;
  if (size === 0) throw new Error("Drive se file download nahi hui (0 bytes). Sharing check karo.");
  return size;
}

/* --------------------------------- YouTube -------------------------------- */

export async function uploadVideo({
  filePath,
  title,
  description,
  tags,
  categoryId,
  privacy,
  publishAt,
  onProgress,
}) {
  const youtube = google.youtube({ version: "v3", auth: authorizedClient() });
  const size = fs.statSync(filePath).size;

  const status = { privacyStatus: privacy, selfDeclaredMadeForKids: false, embeddable: true };
  // Slot aage hai -> YouTube khud us waqt publish karega (server down ho to bhi).
  if (
    privacy === "public" &&
    publishAt &&
    new Date(publishAt).getTime() > Date.now() + 5 * 60 * 1000
  ) {
    status.privacyStatus = "private";
    status.publishAt = new Date(publishAt).toISOString();
  }

  const res = await youtube.videos.insert(
    {
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: String(title).slice(0, 100),
          description: String(description || "").slice(0, 4900),
          tags: (tags || []).slice(0, 30),
          categoryId: String(categoryId || "22"),
        },
        status,
      },
      media: { body: fs.createReadStream(filePath) },
    },
    {
      onUploadProgress: (event) => {
        if (!onProgress || !size) return;
        const percent = Math.min(100, Math.round((event.bytesRead / size) * 100));
        onProgress(percent);
      },
    },
  );

  return res.data;
}

export async function fetchTrending(regionCode = "IN") {
  const youtube = youtubeClient();
  if (!youtube) return [];
  try {
    const res = await youtube.videos.list({
      part: "snippet",
      chart: "mostPopular",
      regionCode,
      maxResults: 25,
    });
    return res.data.items || [];
  } catch (error) {
    console.warn("[google] trending fetch fail:", error.message);
    return [];
  }
}

export function channelInfo() {
  return store.state.google?.channel || null;
}
