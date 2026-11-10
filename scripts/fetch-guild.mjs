// Builds guild.json for guild.html from the Blizzard Profile API (WoW Forever).
// Runs in GitHub Actions (see .github/workflows/news.yml); the browser can't call Blizzard
// directly because the API needs a client secret.
//
// Forever has no realms: guilds and characters are looked up by slug alone
// (/data/wow/guild/{slug}, /profile/wow/character/{name}-{surname}).
// Characters below level 10 (or that have never logged out) return 404 and are listed
// from the roster only.
//
// Environment:
//   BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET  – required
//   BLIZZARD_REGION      – eu | us | kr | tw (default eu)
//   BLIZZARD_NAMESPACE   – namespace flavour (default forever → profile-forever-eu)
//   BLIZZARD_LOCALE      – default en_GB
//   GUILD_SLUG           – default sticky-fingers-rare-proc
//   GUILD_OUTPUT         – output file in the repo root (default guild.json)
//
// Locally: node --env-file=.env scripts/fetch-guild.mjs

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

const OUTPUT_NAME = (process.env.GUILD_OUTPUT || "guild.json").replace(/[^\w.-]/g, "");
const OUTPUT = new URL(`../${OUTPUT_NAME}`, import.meta.url);
const CREST_DIR = new URL("../assets/crest/", import.meta.url);
const USER_AGENT = "StickyFingersGuildSite/1.0 (+https://github.com/Bootcutter/Sticky-Fingers)";
const env = process.env;
const region = (env.BLIZZARD_REGION || "eu").toLowerCase();
const flavour = (env.BLIZZARD_NAMESPACE || "forever").toLowerCase().replace(/-+$/, "");
const locale = env.BLIZZARD_LOCALE || "en_GB";
const guildSlug = (env.GUILD_SLUG || "sticky-fingers-rare-proc").toLowerCase();
const CONCURRENCY = 4;

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

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function makeClient(token) {
  return async function blizzard(path, kind) {
    const url = new URL(`https://${region}.api.blizzard.com${path}`);
    url.searchParams.set("namespace", namespace(kind));
    url.searchParams.set("locale", locale);
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT } });
      if (response.ok) return response.json();
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw new HttpError(`${path} (${namespace(kind)}) returned HTTP ${response.status}`, response.status);
    }
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function toIso(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function round(value, digits = 1) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function describeActivity(entry) {
  const date = toIso(entry.timestamp);
  if (entry.character_achievement) {
    const { character, achievement } = entry.character_achievement;
    return { type: "Achievement", title: achievement?.name, who: [character?.name, character?.surname].filter(Boolean).join(" "), date };
  }
  if (entry.encounter_completed) {
    const { encounter, mode } = entry.encounter_completed;
    return { type: "Boss kill", title: encounter?.name, who: mode?.name, date };
  }
  return null;
}

function professionList(data) {
  const pick = (entries, type) => (entries || []).map((entry) => {
    // Forever reports one tier per profession; take the highest if there are several.
    const tiers = entry.tiers || [];
    const best = tiers.reduce((top, tier) => (!top || tier.skill_points > top.skill_points ? tier : top), null);
    return {
      name: entry.profession?.name,
      type,
      skill: best?.skill_points ?? entry.skill_points ?? 0,
      max: best?.max_skill_points ?? entry.max_skill_points ?? 0,
      recipes: tiers.reduce((sum, tier) => sum + (tier.known_recipes?.length || 0), 0),
      known: [...new Set(tiers.flatMap((tier) => (tier.known_recipes || []).map((recipe) => recipe.name)).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
    };
  }).filter((item) => item.name);
  return [...pick(data.primaries, "primary"), ...pick(data.secondaries, "secondary")];
}

function activeSpec(data) {
  const group = (data.specialization_groups || []).find((item) => item.is_active) || data.specialization_groups?.[0];
  if (!group) return null;
  // Classic-style trees: the active "spec" is the tree with the most points spent.
  const trees = (group.specializations || []).map((tree) => ({
    name: tree.specialization?.name ?? tree.specialization_name,
    points: tree.spent_points ?? (tree.talents || []).reduce((sum, talent) => sum + (talent.talent_rank || 0), 0)
  })).filter((tree) => tree.name);
  trees.sort((a, b) => b.points - a.points);
  return trees.length ? { name: trees[0].name, trees } : null;
}

// Compact in-game tooltip: only display strings, so the page can print them as-is.
function itemTooltip(item) {
  const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const green = (color) => color && color.g > 200 && color.r < 100;
  const tip = {
    bind: text(item.binding?.name),
    type: text(item.inventory_type?.name),
    sub: text(item.item_subclass?.name),
    armor: text(item.armor?.display?.display_string),
    damage: text(item.weapon?.damage?.display_string),
    speed: text(item.weapon?.attack_speed?.display_string),
    dps: text(item.weapon?.dps?.display_string),
    stats: (item.stats || []).map((stat) => text(stat.display?.display_string) && { t: stat.display.display_string, g: Boolean(stat.is_equip_bonus || green(stat.display.color)) }).filter(Boolean),
    enchants: (item.enchantments || []).map((entry) => text(entry.display_string)).filter(Boolean),
    spells: (item.spells || []).map((entry) => text(entry.description)).filter(Boolean),
    req: text(item.requirements?.level?.display_string),
    durability: text(item.durability?.display_string),
    desc: text(item.description),
    set: text(item.set?.display_string)
  };
  return Object.fromEntries(Object.entries(tip).filter(([, value]) => value !== null && !(Array.isArray(value) && !value.length)));
}

function equipmentList(data) {
  return (data.equipped_items || []).map((item) => ({
    slot: item.slot?.name,
    slotType: item.slot?.type ?? null,
    id: item.item?.id ?? null,
    name: item.name,
    quality: item.quality?.type,
    level: item.level?.value ?? null,
    tip: itemTooltip(item)
  })).filter((item) => item.slot && item.name);
}

function statsSummary(data) {
  const best = (...values) => round(Math.max(...values.filter(Number.isFinite)));
  const pair = (stat) => (stat && Number.isFinite(stat.effective) ? [stat.base ?? stat.effective, stat.effective] : null);
  const pct = (stat) => round(stat?.value ?? stat);
  const num = (value) => (Number.isFinite(value) ? round(value) : null);
  return {
    attributes: {
      strength: pair(data.strength), agility: pair(data.agility), stamina: pair(data.stamina),
      intellect: pair(data.intellect), spirit: pair(data.spirit), armor: pair(data.armor), defense: pair(data.defense)
    },
    resistances: {
      arcane: data.arcane_resistance?.effective ?? null, fire: data.fire_resistance?.effective ?? null,
      nature: data.nature_resistance?.effective ?? null, frost: data.frost_resistance?.effective ?? null,
      shadow: data.shadow_resistance?.effective ?? null
    },
    melee: {
      min: num(data.main_hand_damage_min), max: num(data.main_hand_damage_max), speed: num(data.main_hand_speed),
      dps: num(data.main_hand_dps), offDps: num(data.off_hand_dps), hit: pct(data.melee_hit), crit: pct(data.melee_crit), haste: pct(data.melee_haste)
    },
    ranged: {
      ap: data.ranged_attack_power ?? null, min: num(data.ranged_damage_min), max: num(data.ranged_damage_max),
      hit: pct(data.ranged_hit), crit: pct(data.ranged_crit), haste: pct(data.ranged_haste)
    },
    spell: {
      healing: data.spell_healing ?? null, hit: pct(data.spell_hit), crit: pct(data.spell_crit), haste: pct(data.spell_haste),
      penetration: data.spell_penetration ?? null, regen: data.mana_regen ?? null, regenCombat: data.mana_regen_combat ?? null
    },
    parry: pct(data.parry),
    block: pct(data.block),
    speed: data.movement_speed ?? null,
    health: data.health ?? null,
    power: data.power ?? null,
    powerType: data.power_type?.name ?? null,
    crit: best(data.melee_crit?.value ?? data.melee_crit, data.spell_crit?.value ?? data.spell_crit, data.ranged_crit?.value ?? data.ranged_crit),
    haste: best(data.melee_haste?.value ?? data.melee_haste, data.spell_haste?.value ?? data.spell_haste),
    dodge: round(data.dodge?.value ?? data.dodge),
    attackPower: data.attack_power ?? null,
    spellPower: data.spell_power ?? null,
    dps: round(data.main_hand_dps)
  };
}

function reputationSummary(data) {
  return (data.reputations || [])
    .map((item) => ({
      faction: item.faction?.name,
      standing: item.standing?.name,
      value: item.standing?.value ?? 0,
      max: item.standing?.max ?? 0,
      tier: item.standing?.tier ?? 0
    }))
    .filter((item) => item.faction)
    .sort((a, b) => b.tier - a.tier || b.value / (b.max || 1) - a.value / (a.max || 1))
    .slice(0, 40);
}

// Completed character achievements, newest first. Descriptions and icons live in the shared catalog.
function achievementSummary(data) {
  const done = (data.achievements || [])
    .filter((entry) => entry.completed_timestamp && entry.achievement?.name)
    .map((entry) => ({ id: entry.achievement.id ?? entry.id, name: entry.achievement.name, date: toIso(entry.completed_timestamp) }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { total: data.total_quantity ?? done.length, points: data.total_points ?? 0, list: done };
}

// Statistics come as nested categories; flatten to { "Total kills": 2088, ... } and keep
// the category each one sits in so the page can group them.
function flattenStatistics(data) {
  const values = {};
  const bosses = [];
  const groups = [];
  const visit = (category, root) => {
    const names = [];
    for (const stat of category.statistics || []) {
      if (!stat.name || !Number.isFinite(stat.quantity)) continue;
      values[stat.name] = stat.quantity;
      names.push(stat.name);
      const boss = root === "Dungeons & Raids" && stat.name.match(/^(.+?) [Kk]ills \((.+)\)$/);
      if (boss) bosses.push({ boss: boss[1], instance: boss[2], kills: stat.quantity });
    }
    if (names.length) {
      const label = category.name && category.name !== root ? `${root} · ${category.name}` : root || category.name || "Other";
      groups.push({ name: label, stats: names });
    }
    for (const sub of category.sub_categories || []) visit(sub, root);
  };
  for (const category of data.categories || []) visit(category, category.name);
  return { values, bosses, groups };
}

// Minimal PNG reader (8-bit RGBA, non-interlaced) to find the character's bounding box
// inside Blizzard's 1600x1200 transparent render, so the page can crop to the figure.
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function pngAlphaBox(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) throw new Error(`unsupported PNG (depth ${bitDepth}, type ${colorType})`);
  const bpp = 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const start = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? line[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let value = raw[start + i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      line[i] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      if (line[x * bpp + 3] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    prev.set(line);
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, W: width, H: height };
}

async function characterRender(media, previous) {
  const urls = (media?.assets || []).map((asset) => asset.value).filter((url) => typeof url === "string");
  const main = urls.find((url) => /-main-raw\.png$/.test(url));
  const avatar = urls.find((url) => /-avatar\.jpg$/.test(url));
  if (!main) return null;
  const render = { main, avatar: avatar || null, box: null };
  try {
    const response = await fetch(main, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render.box = pngAlphaBox(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.warn(`Render crop for ${main} unavailable: ${error.message}`);
    if (previous?.main === main) render.box = previous.box ?? null;
  }
  return render;
}

async function fetchCharacter(blizzard, slug, previous) {
  const base = `/profile/wow/character/${encodeURIComponent(slug)}`;
  const profile = await blizzard(base, "profile");
  const parts = await Promise.allSettled([
    blizzard(`${base}/professions`, "profile"),
    blizzard(`${base}/specializations`, "profile"),
    blizzard(`${base}/equipment`, "profile"),
    blizzard(`${base}/statistics`, "profile"),
    blizzard(`${base}/quests/completed`, "profile"),
    blizzard(`${base}/pvp-summary`, "profile"),
    blizzard(`${base}/reputations`, "profile"),
    blizzard(`${base}/titles`, "profile"),
    blizzard(`${base}/achievements/statistics`, "profile"),
    blizzard(`${base}/character-media`, "profile"),
    blizzard(`${base}/collections/mounts`, "profile"),
    blizzard(`${base}/collections/pets`, "profile"),
    blizzard(`${base}/achievements`, "profile")
  ]);
  const [professions, specs, equipment, stats, quests, pvp, reputations, titles, statistics, media, mounts, pets, achievements] =
    parts.map((part) => (part.status === "fulfilled" ? part.value : null));

  return {
    gender: profile.gender?.type ?? null,
    race: profile.race?.name ?? null,
    className: profile.character_class?.name ?? null,
    level: profile.level ?? null,
    experience: profile.experience ?? null,
    lastLogin: toIso(profile.last_login_timestamp),
    itemLevel: profile.equipped_item_level ?? profile.average_item_level ?? null,
    achievementPoints: profile.achievement_points ?? 0,
    title: profile.active_title?.name ?? null,
    spec: specs ? activeSpec(specs) : null,
    professions: professions ? professionList(professions) : [],
    equipment: equipment ? equipmentList(equipment) : [],
    stats: stats ? statsSummary(stats) : null,
    questsCompleted: quests?.quests?.length ?? null,
    honorableKills: pvp?.honorable_kills ?? null,
    reputations: reputations ? reputationSummary(reputations) : [],
    titles: (titles?.titles || []).map((item) => item.name).filter(Boolean),
    statistics: statistics ? flattenStatistics(statistics) : previous?.statistics ?? null,
    // character-media can 404 for hours after a character first appears.
    render: media ? await characterRender(media, previous?.render) : previous?.render ?? null,
    mounts: mounts?.mounts?.length ?? null,
    pets: pets?.pets?.length ?? null,
    achievements: achievements ? achievementSummary(achievements) : previous?.achievements ?? null
  };
}

// Item icons and achievement descriptions never change, so they are cached in the output
// file's `catalog` and only missing ids are looked up (capped per run to keep it quick).
const CATALOG_LIMIT = { items: 400, achievements: 200, wowhead: 300 };

// Does Wowhead's Classic database know this item? Forever-only items 404 there, so the page
// only links to Wowhead (which lists drops, vendors and quests) when the answer is yes.
async function onWowhead(id) {
  const response = await fetch(`https://nether.wowhead.com/classic/tooltip/item/${id}?dataEnv=4&locale=0`, { headers: { "User-Agent": USER_AGENT } });
  if (response.ok) return true;
  if (response.status === 404) return false;
  throw new Error(`Wowhead returned HTTP ${response.status}`);
}

async function buildCatalog(blizzard, members, previous) {
  const catalog = {
    items: { ...(previous?.items || {}) },
    achievements: { ...(previous?.achievements || {}) },
    wowhead: { ...(previous?.wowhead || {}) }
  };
  const icon = (media) => media?.assets?.find((asset) => asset.key === "icon")?.value ?? null;
  const itemIds = new Set();
  const achievementIds = new Set();
  for (const member of members) {
    for (const item of member.details?.equipment || []) if (item.id) itemIds.add(String(item.id));
    for (const entry of member.details?.achievements?.list || []) if (entry.id) achievementIds.add(String(entry.id));
  }
  const missingItems = [...itemIds].filter((id) => !(id in catalog.items)).slice(0, CATALOG_LIMIT.items);
  const missingAchievements = [...achievementIds].filter((id) => !(id in catalog.achievements)).slice(0, CATALOG_LIMIT.achievements);
  const missingWowhead = [...itemIds].filter((id) => !(id in catalog.wowhead)).slice(0, CATALOG_LIMIT.wowhead);

  await mapLimit(missingWowhead, 4, async (id) => {
    try {
      catalog.wowhead[id] = await onWowhead(id);
    } catch (error) {
      // Unknown for now; asked again on the next run.
    }
  });

  await mapLimit(missingItems, 8, async (id) => {
    try {
      catalog.items[id] = icon(await blizzard(`/data/wow/media/item/${id}`, "static"));
    } catch (error) {
      if (error.status === 404) catalog.items[id] = null;
    }
  });
  await mapLimit(missingAchievements, 8, async (id) => {
    try {
      const [info, media] = await Promise.all([
        blizzard(`/data/wow/achievement/${id}`, "static"),
        blizzard(`/data/wow/media/achievement/${id}`, "static").catch(() => null)
      ]);
      catalog.achievements[id] = {
        description: info.description ?? null,
        category: info.category?.name ?? null,
        points: info.points ?? 0,
        reward: info.reward_description ?? null,
        icon: icon(media)
      };
    } catch (error) {
      if (error.status === 404) catalog.achievements[id] = null;
    }
  });
  const pending = itemIds.size + achievementIds.size - Object.keys(catalog.items).length - Object.keys(catalog.achievements).length;
  if (pending > 0) console.log(`Catalog: about ${pending} icons/achievements left for later runs.`);
  return catalog;
}

// The guild profile only includes `crest` once a tabard has been designed in game.
// Tabard images are saved into assets/crest/ because the render server sends no CORS
// headers for them, and the page tints them with CSS masks (which need same-origin images).
// Forever's own tabard path currently returns 403, so fall back to the retail path.
async function fetchCrest(blizzard, crest) {
  if (!crest?.emblem || !crest?.border) return null;
  const rgba = (color) => (color?.rgba ? { r: color.rgba.r, g: color.rgba.g, b: color.rgba.b, a: color.rgba.a ?? 1 } : null);
  const image = async (kind, id) => {
    const media = await blizzard(`/data/wow/media/guild-crest/${kind}/${id}`, "static");
    const url = media.assets?.find((asset) => asset.key === "image")?.value;
    if (!url) return null;
    for (const candidate of [url, url.replace(/\/forever-([a-z]+)\//, "/$1/")]) {
      const response = await fetch(candidate, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok || !(response.headers.get("content-type") || "").startsWith("image/png")) continue;
      await mkdir(CREST_DIR, { recursive: true });
      const name = `${kind}-${Number(id)}.png`;
      await writeFile(new URL(name, CREST_DIR), Buffer.from(await response.arrayBuffer()));
      return `assets/crest/${name}`;
    }
    return null;
  };
  const [emblem, border] = await Promise.all([image("emblem", crest.emblem.id), image("border", crest.border.id)]);
  return {
    emblem: { image: emblem, color: rgba(crest.emblem.color) },
    border: { image: border, color: rgba(crest.border.color) },
    background: rgba(crest.background?.color)
  };
}

async function fetchRulesets(blizzard) {
  const index = await blizzard("/data/wow/ruleset/index", "dynamic");
  const ids = (index.rulesets || []).map((item) => item.id).filter(Number.isFinite);
  const details = await Promise.allSettled(ids.map((id) => blizzard(`/data/wow/ruleset/${id}`, "dynamic")));
  return details.filter((item) => item.status === "fulfilled").map(({ value }) => ({
    id: value.id, name: value.name, status: value.status?.type ?? null, statusName: value.status?.name ?? null
  }));
}

const VOLATILE_KEYS = new Set(["lastLogin"]);

function meaningful(value) {
  return JSON.stringify(value, (key, item) => (VOLATILE_KEYS.has(key) ? undefined : item));
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUTPUT, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  if (!env.BLIZZARD_CLIENT_ID || !env.BLIZZARD_CLIENT_SECRET) {
    // Shows as a yellow annotation on the Actions run instead of passing silently.
    console.warn(`${env.GITHUB_ACTIONS ? "::warning::" : ""}No Blizzard credentials set (add the BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET repo secrets); ${OUTPUT_NAME} not updated.`);
    return;
  }

  const previous = await readPrevious();
  const previousDetails = new Map((previous.members || []).filter((m) => m.details).map((m) => [m.slug, m.details]));
  const blizzard = makeClient(await blizzardToken());
  const guildPath = `/data/wow/guild/${encodeURIComponent(guildSlug)}`;

  const [profile, roster, activity, achievements, classes, races] = await Promise.allSettled([
    blizzard(guildPath, "profile"),
    blizzard(`${guildPath}/roster`, "profile"),
    blizzard(`${guildPath}/activity`, "profile"),
    blizzard(`${guildPath}/achievements`, "profile"),
    blizzard("/data/wow/playable-class/index", "static"),
    blizzard("/data/wow/playable-race/index", "static")
  ]);
  if (profile.status === "rejected") throw profile.reason;
  if (roster.status === "rejected") throw roster.reason;

  const [crest, rulesets] = await Promise.allSettled([
    fetchCrest(blizzard, profile.value.crest),
    fetchRulesets(blizzard)
  ]);
  if (crest.status === "rejected") console.warn(`Guild crest unavailable: ${crest.reason.message}`);
  if (rulesets.status === "rejected") console.warn(`Ruleset status unavailable: ${rulesets.reason.message}`);

  const classNames = new Map((classes.value?.classes || []).map((item) => [item.id, item.name]));
  const raceNames = new Map((races.value?.races || []).map((item) => [item.id, item.name]));
  const info = profile.value;

  const members = await mapLimit(roster.value.members || [], CONCURRENCY, async (entry) => {
    const character = entry.character || {};
    const slug = character.slug || `${character.name}-${character.surname}`.toLowerCase();
    const member = {
      name: character.name,
      surname: character.surname || "",
      slug,
      rank: entry.rank,
      level: character.level ?? null,
      classId: character.playable_class?.id ?? null,
      className: classNames.get(character.playable_class?.id) ?? null,
      raceId: character.playable_race?.id ?? null,
      race: raceNames.get(character.playable_race?.id) ?? null,
      details: null,
      detailsStale: false
    };
    try {
      member.details = await fetchCharacter(blizzard, slug, previousDetails.get(slug));
    } catch (error) {
      if (error.status !== 404) console.warn(`${slug}: ${error.message}`);
      // A transient failure keeps the last good profile; a 404 means none exists yet.
      if (error.status !== 404 && previousDetails.has(slug)) {
        member.details = previousDetails.get(slug);
        member.detailsStale = true;
      }
    }
    if (member.details?.level) member.level = Math.max(member.level ?? 0, member.details.level);
    return member;
  });

  const catalog = await buildCatalog(blizzard, members, previous.catalog);
  const achievementData = achievements.status === "fulfilled" ? achievements.value : null;
  const next = {
    region: region.toUpperCase(),
    guild: {
      id: info.id,
      name: info.name,
      slug: info.slug || guildSlug,
      faction: info.faction?.name ?? null,
      ruleset: info.ruleset?.name ?? null,
      memberCount: info.member_count ?? members.length,
      achievementPoints: info.achievement_points ?? 0,
      created: toIso(info.created_timestamp),
      rulesetId: info.ruleset?.id ?? null,
      crest: crest.status === "fulfilled" ? crest.value : previous.guild?.crest ?? null
    },
    rulesets: rulesets.status === "fulfilled" ? rulesets.value : previous.rulesets || [],
    activity: activity.status === "fulfilled"
      ? (activity.value.activities || []).map(describeActivity).filter((item) => item?.title).slice(0, 12)
      : previous.activity || [],
    achievements: achievementData
      ? {
          total: achievementData.total_quantity ?? 0,
          points: achievementData.total_points ?? info.achievement_points ?? 0,
          recent: (achievementData.recent_events || []).slice(0, 8).map((item) => ({
            name: item.achievement?.name,
            date: toIso(item.timestamp)
          })).filter((item) => item.name)
        }
      : previous.achievements || { total: 0, points: 0, recent: [] },
    members,
    catalog
  };

  // The workflow runs every 10 minutes; skip writes (and so commits) when only volatile
  // fields such as last-login times moved. They catch up with the next real change.
  const { generatedAt, ...previousContent } = previous;
  if (meaningful(previousContent) === meaningful(next)) {
    console.log(`${OUTPUT_NAME} unchanged.`);
    return;
  }
  await writeFile(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...next }, null, 2)}\n`);
  const detailed = members.filter((member) => member.details).length;
  console.log(`${OUTPUT_NAME} written: ${members.length} members, ${detailed} with full profiles.`);
}

main().catch((error) => {
  console.error(`Guild fetch failed: ${error.message}`);
  process.exit(1);
});
