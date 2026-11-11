import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addLog, store } from "./store.js";
import * as google from "./google.js";
import { buildMetadata } from "./metadata.js";

const TICK_MS = 30_000;
const ACTIVE = new Set(["queued", "uploading", "published"]);
const MAX_ATTEMPTS = 3;

let ticking = false;
let timer = null;

/* --------------------------------- slots --------------------------------- */

export function normalizedSlots() {
  const { slots, videosPerDay } = store.settings;
  const valid = (Array.isArray(slots) ? slots : [])
    .map((s) => String(s).trim())
    .filter((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s))
    .sort();
  const count = Math.max(1, Math.min(50, Number(videosPerDay) || 5));
  if (!valid.length) {
    const fallback = [];
    for (let i = 0; i < count; i += 1) {
      const hour = Math.min(23, 8 + i * Math.max(1, Math.floor(13 / count)));
      fallback.push(`${String(hour).padStart(2, "0")}:00`);
    }
    return [...new Set(fallback)];
  }
  return valid.slice(0, count);
}

/** Queue me already booked slots. */
function bookedSlots() {
  const booked = new Set();
  for (const item of store.state.queue) {
    if (!item.publishAt) continue;
    if (item.status === "failed") continue;
    booked.add(new Date(item.publishAt).getTime());
  }
  return booked;
}

/** Agle `count` khaali publish slots (local time). */
export function planSlots(count) {
  const slots = normalizedSlots();
  const booked = bookedSlots();
  const out = [];
  const now = Date.now() + 60_000;

  for (let dayOffset = 0; dayOffset < 365 && out.length < count; dayOffset += 1) {
    const base = new Date();
    base.setDate(base.getDate() + dayOffset);
    for (const slot of slots) {
      if (out.length >= count) break;
      const [hour, minute] = slot.split(":").map(Number);
      const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
      const time = at.getTime();
      if (time < now) continue;
      if (booked.has(time)) continue;
      booked.add(time);
      out.push(at.toISOString());
    }
  }
  return out;
}

/* ------------------------------- upload one ------------------------------ */

async function ensureMetadata(item) {
  if (item.title && item.autoMetadata !== true) return; // user ne khud likha hai
  const meta = await buildMetadata({ fileName: item.fileName, useAi: true });
  item.title = meta.title;
  item.description = meta.description;
  item.tags = meta.tags;
  item.autoMetadata = true;
  item.metadataSource = meta.source;
}

export async function uploadItem(item) {
  if (!google.connected()) throw new Error("YouTube channel connected nahi hai.");
  const tmpDir = path.join(os.tmpdir(), "yt-autopilot");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `${item.id}.mp4`);

  item.status = "uploading";
  item.progress = 0;
  item.error = null;
  item.attempts = (item.attempts || 0) + 1;
  item.updatedAt = new Date().toISOString();
  store.save();
  addLog("info", `Start: ${item.fileName} (attempt ${item.attempts})`);

  try {
    await ensureMetadata(item);
    store.save();

    const bytes = await google.downloadFile(item.driveFileId, tmpFile);
    addLog("info", `Drive download done — ${(bytes / 1024 / 1024).toFixed(1)} MB`);

    let lastSaved = 0;
    const data = await google.uploadVideo({
      filePath: tmpFile,
      title: item.title,
      description: item.description,
      tags: item.tags,
      categoryId: item.categoryId || store.settings.categoryId,
      privacy: item.privacy || store.settings.privacy,
      publishAt: item.publishAt,
      onProgress: (percent) => {
        item.progress = percent;
        if (Date.now() - lastSaved > 3000) {
          lastSaved = Date.now();
          store.save();
        }
      },
    });

    item.status = "published";
    item.progress = 100;
    item.youtubeId = data.id;
    item.youtubeUrl = `https://youtu.be/${data.id}`;
    item.uploadedAt = new Date().toISOString();
    item.updatedAt = item.uploadedAt;
    item.error = null;
    addLog("success", `Published: ${item.title} → ${item.youtubeUrl}`);
    return item;
  } catch (error) {
    const message = String(error?.message || error).slice(0, 600);
    item.error = message;
    item.updatedAt = new Date().toISOString();
    item.progress = 0;

    const quota = /quota/i.test(message);
    const canRetry = !quota && (item.attempts || 0) < MAX_ATTEMPTS;
    if (canRetry) {
      item.status = "queued";
      item.retryAfter = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      addLog("warn", `Fail (auto retry 10 min me): ${item.fileName} — ${message}`);
    } else {
      item.status = "failed";
      addLog("error", `Fail: ${item.fileName} — ${message}`);
    }
    throw Object.assign(error instanceof Error ? error : new Error(message), { handled: true });
  } finally {
    fs.rm(tmpFile, { force: true }, () => {});
    store.sortQueue();
    store.save();
  }
}

/* -------------------------------- tick loop ------------------------------ */

function countUploadedToday() {
  const now = new Date();
  const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return store.state.queue.filter((item) => {
    if (item.status !== "published" || !item.uploadedAt) return false;
    const d = new Date(item.uploadedAt);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` === today;
  }).length;
}

export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    if (!google.connected()) return;
    const perDay = Math.max(1, Number(store.settings.videosPerDay) || 5);
    const remaining = perDay - countUploadedToday();
    if (remaining <= 0) return;

    const leadMs = Math.max(0, Number(store.settings.uploadLeadMinutes) || 0) * 60_000;
    const now = Date.now();

    const due = store.state.queue
      .filter((item) => {
        if (item.status !== "queued") return false;
        if (item.retryAfter && new Date(item.retryAfter).getTime() > now) return false;
        return new Date(item.publishAt).getTime() - leadMs <= now;
      })
      .sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt))
      .slice(0, remaining);

    for (const item of due) {
      try {
        await uploadItem(item);
      } catch {
        /* already logged */
      }
    }
  } catch (error) {
    addLog("error", `Scheduler error: ${error.message}`);
  } finally {
    ticking = false;
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((error) => console.error("[scheduler]", error));
  }, TICK_MS);
  setTimeout(() => {
    tick().catch((error) => console.error("[scheduler]", error));
  }, 3000);
  console.log(`[scheduler] chal raha hai — TZ ${process.env.TZ}, slots: ${normalizedSlots().join(", ")}`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function stats() {
  const queue = store.state.queue;
  const count = (status) => queue.filter((i) => i.status === status).length;
  const upcoming = queue
    .filter((i) => i.status === "queued")
    .sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt))[0];

  return {
    total: queue.filter((i) => ACTIVE.has(i.status)).length,
    queued: count("queued"),
    uploading: count("uploading"),
    published: count("published"),
    failed: count("failed"),
    publishedToday: countUploadedToday(),
    videosPerDay: Math.max(1, Number(store.settings.videosPerDay) || 5),
    nextPublishAt: upcoming?.publishAt || null,
    nextFile: upcoming?.fileName || null,
    slots: normalizedSlots(),
    timezone: process.env.TZ,
  };
}
