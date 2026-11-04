// Builds news.json from the Wowhead RSS feed and the Blizzard Game Data / Profile APIs.
// Runs in GitHub Actions (see .github/workflows/news.yml) because neither source can be
// read from the browser: Wowhead sends no CORS headers and Blizzard needs a client secret.
//
// Environment:
//   BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET  – optional; Blizzard data is skipped without them
//   BLIZZARD_REGION      – eu | us | kr | tw (default eu)
//   BLIZZARD_NAMESPACE   – namespace flavour, e.g. "classic" for profile-classic-eu (default: none)
//   BLIZZARD_LOCALE      – default en_GB
//   GUILD_REALM          – realm slug, e.g. "firemaw"
//   GUILD_SLUG           – guild name slug, e.g. "sticky-fingers"
//   WOWHEAD_FEED         – default https://www.wowhead.com/news/rss/forever
//   NEWS_LIMIT           – number of Wowhead items to keep (default 9)

import { readFile, writeFile } from "node:fs/promises";

const OUTPUT = new URL("../news.json", import.meta.url);
const USER_AGENT = "StickyFingersGuildSite/1.0 (+https://github.com/Bootcutter/Sticky-Fingers)";
const env = process.env;
const region = (env.BLIZZARD_REGION || "eu").toLowerCase();
const flavour = (env.BLIZZARD_NAMESPACE || "").toLowerCase().replace(/-+$/, "");
const locale = env.BLIZZARD_LOCALE || "en_GB";
const feedUrl = env.WOWHEAD_FEED || "https://www.wowhead.com/news/rss/forever";
const newsLimit = Number.parseInt(env.NEWS_LIMIT || "9", 10);

const namedEntities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", raquo: "»" };

function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return namedEntities[code.toLowerCase()] ?? match;
  });
}

function unwrapCdata(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

// Turns an HTML fragment into plain text paragraphs; the site only ever renders text.
function toPlainText(html) {
  return decodeEntities(
    html
      .replace(/<(?:br|\/p|p)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!match) return "";
  // Text outside CDATA is XML-escaped (Wowhead escapes the HTML in <description>).
  const raw = match[1].trim();
  return (raw.includes("<![CDATA[") ? unwrapCdata(raw) : decodeEntities(raw)).trim();
}

function attr(xml, name, attribute) {
  const match = xml.match(new RegExp(`<${name}\\b[^>]*\\b${attribute}="([^"]*)"`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).trim()}…`;
}

async function fetchWowhead() {
  const response = await fetch(feedUrl, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml" } });
  if (!response.ok) throw new Error(`Wowhead feed returned HTTP ${response.status}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);

  return items.slice(0, newsLimit).map((item) => {
    const link = safeHttpsUrl(decodeEntities(tag(item, "link")));
    const summary = toPlainText(tag(item, "description")).replace(/\s*Continue reading »$/, "");
    const body = toPlainText(tag(item, "content:encoded"));
    // content:encoded repeats the summary as its first paragraph.
    const details = body.startsWith(summary) ? body.slice(summary.length).trim() : body;
    const published = new Date(tag(item, "pubDate"));
    return {
      id: `wowhead-${(tag(item, "guid").match(/news=(\d+)/) || [])[1] || link}`,
      source: "Wowhead",
      title: toPlainText(tag(item, "title")),
      description: truncate(summary, 220),
      details: truncate(details, 900),
      category: toPlainText(tag(item, "category")) || "News",
      date: Number.isNaN(published.getTime()) ? null : published.toISOString(),
      image: safeHttpsUrl(attr(item, "media:content", "url")),
      url: link
    };
  }).filter((item) => item.title && item.url);
}

function namespace(kind) {
  return flavour ? `${kind}-${flavour}-${region}` : `${kind}-${region}`;
}

async function blizzardToken() {
  const credentials = Buffer.from(`${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://oauth.battle.net/token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error(`Blizzard OAuth returned HTTP ${response.status}`);
  return (await response.json()).access_token;
}

async function blizzard(token, path, kind) {
  const url = new URL(`https://${region}.api.blizzard.com${path}`);
  url.searchParams.set("namespace", namespace(kind));
  url.searchParams.set("locale", locale);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${path} (${namespace(kind)}) returned HTTP ${response.status}`);
  return response.json();
}

function describeActivity(entry) {
  const date = new Date(entry.timestamp).toISOString();
  if (entry.character_achievement) {
    const { character, achievement } = entry.character_achievement;
    return { type: "Achievement", title: achievement?.name, who: character?.name, date };
  }
  if (entry.encounter_completed) {
    const { encounter, mode } = entry.encounter_completed;
    return { type: "Boss kill", title: encounter?.name, who: mode?.name, date };
  }
  return null;
}

async function fetchGuild(token) {
  const realm = encodeURIComponent(env.GUILD_REALM.toLowerCase());
  const guild = encodeURIComponent(env.GUILD_SLUG.toLowerCase());
  const [profile, activity] = await Promise.allSettled([
    blizzard(token, `/data/wow/guild/${realm}/${guild}`, "profile"),
    blizzard(token, `/data/wow/guild/${realm}/${guild}/activity`, "profile")
  ]);
  if (profile.status === "rejected") throw profile.reason;
  if (activity.status === "rejected") console.warn(`Guild activity unavailable: ${activity.reason.message}`);

  const info = profile.value;
  return {
    name: info.name,
    realm: info.realm?.name,
    faction: info.faction?.name,
    members: info.member_count,
    achievementPoints: info.achievement_points,
    activity: activity.status === "fulfilled"
      ? (activity.value.activities || []).map(describeActivity).filter((item) => item?.title).slice(0, 8)
      : []
  };
}

// Realm details work before launch; status/population (connected realm) appear once realms go live.
async function fetchRealm(token) {
  const slug = encodeURIComponent(env.GUILD_REALM.toLowerCase());
  const realm = await blizzard(token, `/data/wow/realm/${slug}`, "dynamic");
  const result = { name: realm.name, type: realm.type?.name, category: realm.category };

  const connectedId = realm.connected_realm?.href?.match(/connected-realm\/(\d+)/)?.[1];
  if (connectedId) {
    try {
      const connected = await blizzard(token, `/data/wow/connected-realm/${connectedId}`, "dynamic");
      result.status = connected.status?.name;
      result.population = connected.population?.name;
    } catch (error) {
      console.warn(`Realm status unavailable: ${error.message}`);
    }
  }
  return result;
}

async function fetchBlizzard() {
  if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) {
    console.warn("No Blizzard credentials set; skipping Blizzard data.");
    return null;
  }

  if (!env.GUILD_REALM) {
    console.warn("GUILD_REALM not set; skipping Blizzard data.");
    return null;
  }

  const token = await blizzardToken();
  const result = { region: region.toUpperCase(), realm: await fetchRealm(token) };
  if (env.GUILD_SLUG) {
    try {
      result.guild = await fetchGuild(token);
    } catch (error) {
      // Expected until the guild exists in game.
      console.warn(`Guild data unavailable: ${error.message}`);
    }
  }
  return result;
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUTPUT, "utf8"));
  } catch {
    return {};
  }
}

const previous = await readPrevious();
const [wowhead, blizzardData] = await Promise.allSettled([fetchWowhead(), fetchBlizzard()]);

// Keep the last good data for a source that failed this run.
const next = {
  news: wowhead.status === "fulfilled" ? wowhead.value : previous.news || [],
  blizzard: blizzardData.status === "fulfilled" ? blizzardData.value ?? previous.blizzard ?? null : previous.blizzard ?? null
};
if (wowhead.status === "rejected") console.error(`Wowhead failed: ${wowhead.reason.message}`);
if (blizzardData.status === "rejected") console.error(`Blizzard failed: ${blizzardData.reason.message}`);

const { generatedAt, ...previousContent } = previous;
if (JSON.stringify(previousContent) === JSON.stringify(next)) {
  console.log("news.json unchanged.");
} else {
  await writeFile(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...next }, null, 2)}\n`);
  console.log(`news.json written: ${next.news.length} Wowhead items, Blizzard ${next.blizzard ? "included" : "skipped"}.`);
}

if (wowhead.status === "rejected" && blizzardData.status === "rejected") process.exit(1);
