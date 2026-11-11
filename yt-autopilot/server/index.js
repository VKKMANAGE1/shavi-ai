import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";

import { PUBLIC_DIR, env } from "./config.js";
import { addLog, store } from "./store.js";
import {
  checkPassword,
  clearOAuthState,
  clearSession,
  createSession,
  makeOAuthState,
  readSession,
  verifyOAuthState,
} from "./session.js";
import * as google from "./google.js";
import { buildMetadata } from "./metadata.js";
import { parseDriveInput } from "./drive-links.js";
import {
  planSlots,
  startScheduler,
  stats,
  tick,
  uploadItem,
} from "./scheduler.js";

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const CATEGORIES = [
  { id: "1", name: "Film & Animation" },
  { id: "2", name: "Autos & Vehicles" },
  { id: "10", name: "Music" },
  { id: "15", name: "Pets & Animals" },
  { id: "17", name: "Sports" },
  { id: "20", name: "Gaming" },
  { id: "22", name: "People & Blogs" },
  { id: "23", name: "Comedy" },
  { id: "24", name: "Entertainment" },
  { id: "25", name: "News & Politics" },
  { id: "26", name: "Howto & Style" },
  { id: "27", name: "Education" },
  { id: "28", name: "Science & Technology" },
];

/* ------------------------------- login page ------------------------------ */

app.get("/login", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.post("/api/login", (req, res) => {
  if (!env.appPassword) return res.json({ ok: true });
  if (!checkPassword(req.body?.password)) {
    return res.status(401).json({ error: "Password galat hai." });
  }
  createSession(res);
  res.json({ ok: true });
});

// index.html direct kholne par bhi login guard lage.
app.get(["/index.html", "/index.htm"], (req, res) => res.redirect("/"));

app.use(express.static(PUBLIC_DIR, { index: false }));

/* -------------------------------- session -------------------------------- */

function requireSession(req, res, next) {
  if (!env.appPassword) return next();
  if (readSession(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Sign in required" });
  return res.redirect("/login");
}

app.use(requireSession);

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

/* --------------------------------- status -------------------------------- */

function setupInfo(req) {
  return {
    clientConfigured: google.clientConfigured(),
    aiConfigured: Boolean(env.aiApiKey),
    passwordProtected: Boolean(env.appPassword),
    redirectUri: google.redirectUri(req),
    categories: CATEGORIES,
    timezone: env.timezone,
  };
}

app.get("/api/status", (req, res) => {
  const channel = google.channelInfo();
  res.json({
    connected: google.connected(),
    channel,
    connectedAt: store.state.google?.connectedAt || null,
    settings: store.settings,
    stats: stats(),
    setup: setupInfo(req),
    logs: store.state.logs.slice(0, 40),
  });
});

/* ---------------------------------- queue -------------------------------- */

function summarize(item) {
  return {
    id: item.id,
    driveFileId: item.driveFileId,
    driveUrl: item.driveUrl,
    fileName: item.fileName,
    sizeBytes: item.sizeBytes || 0,
    title: item.title,
    description: item.description,
    tags: item.tags || [],
    autoMetadata: Boolean(item.autoMetadata),
    metadataSource: item.metadataSource || null,
    publishAt: item.publishAt,
    privacy: item.privacy,
    categoryId: item.categoryId,
    status: item.status,
    progress: item.progress || 0,
    youtubeId: item.youtubeId || null,
    youtubeUrl: item.youtubeUrl || null,
    error: item.error || null,
    attempts: item.attempts || 0,
    uploadedAt: item.uploadedAt || null,
  };
}

app.get("/api/queue", (req, res) => {
  store.sortQueue();
  res.json({ items: store.state.queue.map(summarize) });
});

app.post("/api/queue", async (req, res) => {
  const input = String(req.body?.input || "").trim();
  if (!input) return res.status(400).json({ error: "Drive link ya folder link daalo." });
  if (!google.connected() && !env.googleApiKey) {
    return res.status(400).json({
      error:
        "Pehle YouTube channel connect karo (ya .env me GOOGLE_API_KEY daalo), tab hi Drive files padh paayenge.",
    });
  }

  const entries = parseDriveInput(input);
  if (!entries.length) {
    return res.status(400).json({ error: "Koi valid Google Drive link nahi mila." });
  }

  const problems = [];
  const files = [];
  for (const entry of entries) {
    try {
      if (entry.kind === "folder") {
        const list = await google.listFolderVideos(entry.id);
        if (!list.length) problems.push(`Folder ${entry.id}: koi video file nahi mili.`);
        files.push(...list);
      } else {
        files.push(await google.getFileMeta(entry.id));
      }
    } catch (error) {
      problems.push(`${entry.kind} ${entry.id}: ${error.message}`);
    }
  }

  const existing = new Set(store.state.queue.map((i) => i.driveFileId));
  const fresh = [];
  for (const file of files) {
    if (!file?.id || existing.has(file.id)) continue;
    if (file.mimeType && !String(file.mimeType).startsWith("video/")) {
      problems.push(`${file.name || file.id}: video file nahi hai.`);
      continue;
    }
    existing.add(file.id);
    fresh.push(file);
  }

  if (!fresh.length) {
    return res.status(400).json({
      error: "Queue me add karne ke liye koi naya video nahi mila.",
      problems,
    });
  }

  const slots = planSlots(fresh.length);
  const useAi = fresh.length <= 5;
  let added = 0;

  for (let index = 0; index < fresh.length; index += 1) {
    const file = fresh[index];
    const fileName = file.name || `${file.id}.mp4`;
    let meta;
    try {
      meta = await buildMetadata({ fileName, useAi });
    } catch {
      meta = { title: fileName.replace(/\.[a-z0-9]+$/i, ""), description: "", tags: [] };
    }
    const publishAt = slots[index] || new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    store.state.queue.push({
      id: crypto.randomUUID(),
      driveFileId: file.id,
      driveUrl: `https://drive.google.com/file/d/${file.id}/view`,
      fileName,
      sizeBytes: Number(file.size || 0),
      durationMs: Number(file.videoMediaMetadata?.durationMillis || 0),
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      autoMetadata: true,
      metadataSource: meta.source || null,
      publishAt,
      privacy: store.settings.privacy,
      categoryId: store.settings.categoryId,
      status: "queued",
      progress: 0,
      attempts: 0,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    added += 1;
  }

  store.sortQueue();
  store.save();
  addLog("info", `${added} video queue me add hua.`);
  res.json({ added, problems, items: store.state.queue.map(summarize) });
});

app.patch("/api/queue/:id", (req, res) => {
  const item = store.state.queue.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item nahi mila." });
  const body = req.body || {};

  if (typeof body.title === "string") {
    item.title = body.title.slice(0, 100);
    item.autoMetadata = false;
  }
  if (typeof body.description === "string") item.description = body.description.slice(0, 4800);
  if (Array.isArray(body.tags)) {
    item.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 25);
  } else if (typeof body.tags === "string") {
    item.tags = body.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 25);
  }
  if (typeof body.publishAt === "string" && !Number.isNaN(Date.parse(body.publishAt))) {
    item.publishAt = new Date(body.publishAt).toISOString();
  }
  if (["public", "unlisted", "private"].includes(body.privacy)) item.privacy = body.privacy;
  if (typeof body.categoryId === "string" && /^\d{1,2}$/.test(body.categoryId)) {
    item.categoryId = body.categoryId;
  }
  item.updatedAt = new Date().toISOString();
  store.sortQueue();
  store.save();
  res.json({ item: summarize(item) });
});

app.post("/api/queue/:id/regenerate", async (req, res) => {
  const item = store.state.queue.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item nahi mila." });
  const meta = await buildMetadata({ fileName: item.fileName, useAi: true });
  item.title = meta.title;
  item.description = meta.description;
  item.tags = meta.tags;
  item.autoMetadata = true;
  item.metadataSource = meta.source;
  item.updatedAt = new Date().toISOString();
  store.save();
  res.json({ item: summarize(item) });
});

app.post("/api/queue/:id/publish-now", async (req, res) => {
  const item = store.state.queue.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item nahi mila." });
  if (item.status === "published") return res.status(400).json({ error: "Ye video already publish ho chuka hai." });
  if (!google.connected()) return res.status(400).json({ error: "Pehle YouTube connect karo." });

  item.publishAt = new Date().toISOString();
  item.retryAfter = null;
  item.attempts = 0;
  item.updatedAt = new Date().toISOString();
  store.save();

  // Upload background me chalta hai (video bada ho sakta hai), progress queue/log se dikhti hai.
  uploadItem(item).catch((error) => console.error("[publish-now]", error.message));
  res.json({ ok: true, item: summarize(item) });
});

app.post("/api/queue/:id/retry", async (req, res) => {
  const item = store.state.queue.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Item nahi mila." });
  item.status = "queued";
  item.error = null;
  item.attempts = 0;
  item.retryAfter = null;
  if (new Date(item.publishAt).getTime() < Date.now()) {
    item.publishAt = new Date(Date.now() + 60_000).toISOString();
  }
  item.updatedAt = new Date().toISOString();
  store.sortQueue();
  store.save();
  tick().catch(() => {});
  res.json({ item: summarize(item) });
});

app.delete("/api/queue/:id", (req, res) => {
  const before = store.state.queue.length;
  store.state.queue = store.state.queue.filter((i) => i.id !== req.params.id);
  if (store.state.queue.length === before) return res.status(404).json({ error: "Item nahi mila." });
  store.save();
  res.json({ ok: true });
});

/* -------------------------------- settings ------------------------------- */

app.put("/api/settings", (req, res) => {
  const body = req.body || {};
  const next = { ...store.settings };

  if (body.videosPerDay !== undefined) {
    const value = Number(body.videosPerDay);
    if (!Number.isFinite(value) || value < 1 || value > 50) {
      return res.status(400).json({ error: "Videos per day 1 se 50 ke beech hona chahiye." });
    }
    next.videosPerDay = Math.round(value);
  }

  if (Array.isArray(body.slots)) {
    const slots = body.slots.map((s) => String(s).trim()).filter((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s));
    if (!slots.length) return res.status(400).json({ error: "Kam se kam ek valid time (HH:MM) do." });
    next.slots = [...new Set(slots)].sort();
  }

  if (["public", "unlisted", "private"].includes(body.privacy)) next.privacy = body.privacy;

  if (body.categoryId !== undefined) {
    const id = String(body.categoryId);
    if (!CATEGORIES.some((c) => c.id === id)) return res.status(400).json({ error: "Category galat hai." });
    next.categoryId = id;
  }

  if (body.uploadLeadMinutes !== undefined) {
    const value = Number(body.uploadLeadMinutes);
    if (!Number.isFinite(value) || value < 0 || value > 10080) {
      return res.status(400).json({ error: "Upload lead time 0 se 10080 minutes ke beech ho." });
    }
    next.uploadLeadMinutes = Math.round(value);
  }

  for (const key of ["niche", "tagPool", "descriptionTemplate", "regionCode"]) {
    if (typeof body[key] === "string") next[key] = body[key].slice(0, 500);
  }
  if (typeof body.aiTitles === "boolean") next.aiTitles = body.aiTitles;

  store.state.settings = next;
  store.save();
  addLog("info", "Settings update hui.");
  res.json({ settings: store.settings });
});

/* ---------------------------------- logs --------------------------------- */

app.get("/api/logs", (req, res) => {
  res.json({ logs: store.state.logs.slice(0, 200) });
});

app.post("/api/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

/* --------------------------------- Google -------------------------------- */

app.get("/api/google/connect", (req, res) => {
  if (!google.clientConfigured()) {
    return res.status(400).json({
      error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET .env me set karo, phir server restart karo.",
    });
  }
  const state = makeOAuthState(res);
  res.redirect(google.authUrl(req, state));
});

app.get("/api/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  try {
    if (error) throw new Error(String(error));
    if (!code) throw new Error("Google ne code nahi bheja.");
    if (!verifyOAuthState(req, state)) throw new Error("OAuth state mismatch. Dobara try karo.");
    clearOAuthState(res);
    await google.exchangeCode(req, code);
    addLog("success", "YouTube channel connect ho gaya.");
    res.redirect("/?connected=1");
  } catch (err) {
    addLog("error", `Google connect fail: ${err.message}`);
    res.redirect(`/?connect_error=${encodeURIComponent(err.message)}`);
  }
});

app.post("/api/google/disconnect", (req, res) => {
  google.disconnect();
  addLog("warn", "YouTube channel disconnect ho gaya.");
  res.json({ ok: true });
});

/* ---------------------------------- misc --------------------------------- */

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error("[server]", err);
  if (req.path.startsWith("/api/")) return res.status(500).json({ error: err.message || "Server error" });
  res.status(500).send("Server error");
});

const server = app.listen(env.port, "0.0.0.0", () => {
  console.log(`YT AutoPilot → http://localhost:${env.port}  (TZ ${env.timezone})`);
  if (!env.appPassword) {
    console.warn("[warn] APP_PASSWORD set nahi hai — dashboard open hai. Public hosting se pehle set karo.");
  }
  if (!google.clientConfigured()) {
    console.warn("[warn] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing — Connect button setup batayega.");
  }
  startScheduler();
});

// Video download/upload lamba chalta hai, is liye request timeout band.
server.requestTimeout = 0;
server.headersTimeout = 65_000;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n[${signal}] band ho raha hai...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  });
}
