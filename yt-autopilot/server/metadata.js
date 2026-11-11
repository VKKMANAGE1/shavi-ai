import { env } from "./config.js";
import { fetchTrending } from "./google.js";
import { store } from "./store.js";

const STOPWORDS = new Set(
  (`a an and are as at be best by for from full how i in is it its ka ki ke ko mein me
   my new of on or our out song the this to video viral vs with what when why you your
   hindi new latest official full hd shorts short subscribe like share comment
   episode ep part trailer teaser update news today live`)
    .split(/\s+/)
    .filter(Boolean),
);

/* ----------------------------- trending keyword ---------------------------- */

let trendingCache = { at: 0, keywords: [] };

export async function trendingKeywords(force = false) {
  const fresh = Date.now() - trendingCache.at < 30 * 60 * 1000;
  if (!force && fresh && trendingCache.keywords.length) return trendingCache.keywords;

  const items = await fetchTrending(store.settings.regionCode || "IN");
  const counts = new Map();
  for (const item of items) {
    const text = `${item.snippet?.title || ""} ${(item.snippet?.tags || []).join(" ")}`;
    for (const rawWord of text.toLowerCase().split(/[^a-z0-9\u0900-\u097F]+/)) {
      const word = rawWord.trim();
      if (word.length < 4 || STOPWORDS.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word]) => word);

  trendingCache = { at: Date.now(), keywords };
  return keywords;
}

/* -------------------------------- helpers -------------------------------- */

export function cleanFileName(fileName = "") {
  const withoutExt = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  let text = withoutExt
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s*[-–|]+\s*/g, " - ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text) text = "New video";
  text = text.replace(/\b\w/g, (c) => c.toUpperCase());
  return text.slice(0, 80);
}

function hashtag(word) {
  return `#${word.replace(/[^\p{L}\p{N}]/gu, "")}`;
}

function hashTags(words) {
  return words
    .slice(0, 4)
    .map(hashtag)
    .filter((t) => t.length > 2)
    .join(" ");
}

function trimTags(tags) {
  const seen = new Set();
  const out = [];
  let budget = 480; // YouTube total tags budget ~500 chars
  for (const raw of tags) {
    const tag = String(raw || "").trim().slice(0, 60);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const cost = tag.length + 1;
    if (cost > budget) break;
    budget -= cost;
    out.push(tag);
    if (out.length >= 25) break;
  }
  return out;
}

function heuristic({ fileName, settings, keywords }) {
  const base = cleanFileName(fileName);
  const k1 = keywords[0] || "";
  const k2 = keywords[1] || "";
  const pool = [...keywords.slice(0, 6), ...(settings.tagPool || "").split(",")];

  const patterns = [
    () => `${base} ${k1 ? `| ${k1}` : ""}`.trim(),
    () => `${base} — ${k1 || "Trending"} ${k2 ? `& ${k2}` : ""}`.trim(),
    () => `${base} | ${k1 || "Viral"} #Shorts`.trim(),
    () => `${k1 ? `${k1} ` : ""}${base} (Full Video)`.trim(),
  ];
  const title = patterns[Math.floor(Math.random() * patterns.length)]().slice(0, 100);

  const tags = trimTags([
    ...base.split(/\s+/),
    ...keywords,
    ...pool.map((t) => String(t).trim()),
    ...(settings.tagPool || "").split(","),
  ]);

  const hashtags = hashTags([...keywords.slice(0, 3), "shorts", "trending"]);
  const description = [
    title,
    "",
    settings.descriptionTemplate || "",
    "",
    hashtags,
  ]
    .join("\n")
    .slice(0, 4800);

  return { title, description, tags };
}

/* ---------------------------------- AI ----------------------------------- */

function extractJson(text = "") {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function aiMetadata({ fileName, settings, keywords }) {
  const body = {
    model: env.aiModel,
    temperature: 0.8,
    messages: [
      {
        role: "system",
        content:
          "You are a YouTube growth strategist. Reply with STRICT JSON only: " +
          '{"title":string,"description":string,"tags":string[]}. ' +
          "Title max 100 characters, click-worthy, Hinglish/Hindi friendly, must naturally " +
          "use 1-2 of the trending keywords. description: 2-3 lines + 3 hashtags. " +
          "tags: 10-15 short lowercase tags, no # symbol inside tags.",
      },
      {
        role: "user",
        content: [
          `Drive file name: ${fileName}`,
          `Channel niche: ${settings.niche || "general"}`,
          `Trending keywords right now: ${keywords.slice(0, 12).join(", ")}`,
        ].join("\n"),
      },
    ],
  };

  const response = await fetch(`${env.aiBaseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.aiApiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`AI ${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content || "";
  const parsed = extractJson(typeof text === "string" ? text : JSON.stringify(text));
  if (!parsed || !parsed.title) throw new Error("AI ne valid JSON nahi diya");
  return {
    title: String(parsed.title).slice(0, 100),
    description: String(parsed.description || "").slice(0, 4800),
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
  };
}

/* -------------------------------- builder -------------------------------- */

/**
 * Title / description / tags banata hai.
 * AI available ho to use karta hai, warna trending keywords se heuristics.
 */
export async function buildMetadata({ fileName, useAi = true }) {
  const settings = store.settings;
  let keywords = [];
  try {
    keywords = await trendingKeywords();
  } catch {
    keywords = [];
  }

  if (useAi && settings.aiTitles && env.aiApiKey) {
    try {
      const ai = await aiMetadata({ fileName, settings, keywords });
      return {
        ...ai,
        tags: trimTags([...ai.tags, ...keywords.slice(0, 5)]),
        source: "ai",
      };
    } catch (error) {
      console.warn("[metadata] AI fallback:", error.message);
    }
  }

  return { ...heuristic({ fileName, settings, keywords }), source: "trending" };
}
