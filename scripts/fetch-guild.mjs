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
//
// Locally: node --env-file=.env scripts/fetch-guild.mjs

import { readFile, writeFile } from "node:fs/promises";

const OUTPUT = new URL("../guild.json", import.meta.url);
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
      recipes: tiers.reduce((sum, tier) => sum + (tier.known_recipes?.length || 0), 0)
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

function equipmentList(data) {
  return (data.equipped_items || []).map((item) => ({
    slot: item.slot?.name,
    name: item.name,
    quality: item.quality?.type,
    level: item.level?.value ?? null
  })).filter((item) => item.slot && item.name);
}

function statsSummary(data) {
  const best = (...values) => round(Math.max(...values.filter(Number.isFinite)));
  return {
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
    .slice(0, 6);
}

async function fetchCharacter(blizzard, slug) {
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
    blizzard(`${base}/titles`, "profile")
  ]);
  const [professions, specs, equipment, stats, quests, pvp, reputations, titles] =
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
    titles: (titles?.titles || []).map((item) => item.name).filter(Boolean)
  };
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
    console.warn("No Blizzard credentials set; guild.json not updated.");
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
      member.details = await fetchCharacter(blizzard, slug);
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
      created: toIso(info.created_timestamp)
    },
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
    members
  };

  const { generatedAt, ...previousContent } = previous;
  if (JSON.stringify(previousContent) === JSON.stringify(next)) {
    console.log("guild.json unchanged.");
    return;
  }
  await writeFile(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...next }, null, 2)}\n`);
  const detailed = members.filter((member) => member.details).length;
  console.log(`guild.json written: ${members.length} members, ${detailed} with full profiles.`);
}

main().catch((error) => {
  console.error(`Guild fetch failed: ${error.message}`);
  process.exit(1);
});
