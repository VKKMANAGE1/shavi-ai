import fs from "node:fs";
import path from "node:path";
import { env } from "./config.js";

const FILE = path.join(env.dataDir, "state.json");

const defaultSettings = {
  videosPerDay: 5,
  slots: ["09:00", "12:00", "15:00", "18:00", "21:00"],
  privacy: "public",
  categoryId: "22",
  uploadLeadMinutes: 30,
  aiTitles: true,
  niche: "general entertainment / viral shorts",
  tagPool: "viral, trending, shorts",
  descriptionTemplate: "Follow for daily new videos. Like & share if you enjoyed!",
  regionCode: "IN",
};

const defaultState = () => ({
  google: null,
  settings: { ...defaultSettings },
  queue: [],
  logs: [],
});

function ensureDir() {
  fs.mkdirSync(env.dataDir, { recursive: true });
  try {
    fs.chmodSync(env.dataDir, 0o700);
  } catch {
    /* ignore on platforms without chmod */
  }
}

class Store {
  constructor() {
    this.state = defaultState();
    this.load();
  }

  load() {
    ensureDir();
    if (!fs.existsSync(FILE)) {
      this.save();
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(FILE, "utf8"));
      this.state = {
        ...defaultState(),
        ...parsed,
        settings: { ...defaultSettings, ...(parsed.settings || {}) },
        queue: Array.isArray(parsed.queue) ? parsed.queue : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      };
    } catch (error) {
      const backup = `${FILE}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(FILE, backup);
      } catch {
        /* ignore */
      }
      console.error("[store] state.json padha nahi ja saka, backup:", backup, error.message);
      this.state = defaultState();
      this.save();
    }
  }

  save() {
    ensureDir();
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }

  get settings() {
    return this.state.settings;
  }

  /** Keep the queue ordered by publish time. */
  sortQueue() {
    this.state.queue.sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
  }
}

export const store = new Store();

export function addLog(level, message) {
  const entry = { at: new Date().toISOString(), level, message: String(message).slice(0, 800) };
  store.state.logs.unshift(entry);
  if (store.state.logs.length > 400) store.state.logs.length = 400;
  const line = `[${entry.at}] ${level.toUpperCase()} ${entry.message}`;
  if (level === "error") console.error(line);
  else console.log(line);
  store.save();
  return entry;
}

export function publicSettings() {
  return { ...store.state.settings };
}
