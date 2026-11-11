import crypto from "node:crypto";
import { env } from "./config.js";

const COOKIE = "ytp_session";
const STATE_COOKIE = "ytp_oauth_state";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function secret() {
  return env.sessionSecret || env.appPassword || "yt-autopilot-local-dev";
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function sessionCookieName() {
  return COOKIE;
}

export function createSession(res) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE_MS })).toString(
    "base64url",
  );
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

export function readSession(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw || typeof raw !== "string" || !raw.includes(".")) return null;
  const [payload, mac] = raw.split(".");
  const expected = sign(payload);
  const a = Buffer.from(mac || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function checkPassword(candidate) {
  if (!env.appPassword) return true;
  const a = Buffer.from(String(candidate || ""));
  const b = Buffer.from(env.appPassword);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function makeOAuthState(res) {
  const state = crypto.randomBytes(24).toString("base64url");
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 1000 * 60 * 15,
    path: "/",
  });
  return state;
}

export function verifyOAuthState(req, state) {
  const saved = req.cookies?.[STATE_COOKIE];
  if (!saved || !state) return false;
  return saved === state;
}

export function clearOAuthState(res) {
  res.clearCookie(STATE_COOKIE, { path: "/" });
}
