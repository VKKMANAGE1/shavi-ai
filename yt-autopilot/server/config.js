import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..");
export const PUBLIC_DIR = path.join(ROOT, "public");

/** Minimal .env loader (no dependency). Existing env vars win. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, ".env"));

const timezone = process.env.TZ || "Asia/Kolkata";
// Scheduler slots local time me bante hain, is liye process ka TZ set karna zaroori hai.
process.env.TZ = timezone;

export const env = {
  port: Number(process.env.PORT || 3001),
  timezone,
  appPassword: (process.env.APP_PASSWORD || "").trim(),
  sessionSecret: (process.env.SESSION_SECRET || "").trim(),
  googleClientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
  googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
  googleRedirectUri: (process.env.GOOGLE_REDIRECT_URI || "").trim(),
  googleApiKey: (process.env.GOOGLE_API_KEY || "").trim(),
  aiBaseUrl: (process.env.AI_BASE_URL || "https://freebuff.com/api/v1/paid").trim(),
  aiApiKey: (process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "").trim(),
  aiModel: (process.env.AI_MODEL || "gpt-4o-mini").trim(),
  dataDir: process.env.DATA_DIR
    ? path.resolve(ROOT, process.env.DATA_DIR)
    : path.join(ROOT, "data"),
};

export const isConfigured = Boolean(env.googleClientId && env.googleClientSecret);
