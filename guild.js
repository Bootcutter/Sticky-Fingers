// Guild dossier: renders guild.json (built hourly by scripts/fetch-guild.mjs),
// guild-notes.json (hand-edited MOTD and rank names) and roster.json (custom portraits).

const CLASS_COLORS = {
  1: "#c69b6d", 2: "#f48cba", 3: "#aad372", 4: "#fff468", 5: "#f4f1ec",
  6: "#c41e3a", 7: "#2a8cff", 8: "#3fc7eb", 9: "#8788ee", 10: "#00ff98", 11: "#ff7c0a", 12: "#a330c9", 13: "#33937f"
};
const MAX_LEVEL = 60;
const CRAFT_LIMIT = 6;
const TANK_SPECS = new Set(["Protection", "Feral Combat", "Guardian", "Blood", "Brewmaster", "Vengeance"]);
const HEALER_SPECS = new Set(["Holy", "Discipline", "Restoration", "Mistweaver", "Preservation"]);
const DEFAULT_RANKS = { 0: "Guild Master", 1: "Officer" };
const REP_COLORS = { Hated: "#cc2222", Hostile: "#ff3b3b", Unfriendly: "#ee6622", Neutral: "#e4c000", Friendly: "#33b04a", Honored: "#2ec27e", Revered: "#2fd0b5", Exalted: "#3fd8ff" };

const $ = (selector) => document.querySelector(selector);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const numberFormat = new Intl.NumberFormat("en-GB");
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const relativeFormat = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

const state = { catalog: {}, crafters: new Map(), members: [], filter: "all", search: "", sort: "level", notes: { ranks: {} }, portraits: new Map(), guildName: "" };

// Each guild page points at its own data via <body data-guild-data data-guild-notes data-portraits>.
// An empty data-portraits skips custom art (roster.json belongs to Sticky Fingers).
const PAGE = {
  data: document.body.dataset.guildData || "guild.json",
  notes: document.body.dataset.guildNotes || "guild-notes.json",
  portraits: document.body.dataset.portraits ?? "roster.json"
};

// ---------- Small DOM helpers (all data goes through textContent) ----------

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "style") Object.entries(value).forEach(([prop, v]) => node.style.setProperty(prop, v));
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Only ever called with markup built from constants in this file.
function svgNode(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

function normalise(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function fullName(member) {
  return [member.name, member.surname].filter(Boolean).join(" ");
}

function classColor(member) {
  return CLASS_COLORS[member.classId] || "#f02025";
}

function rankName(rank) {
  return state.notes.ranks?.[rank] || DEFAULT_RANKS[rank] || `Rank ${rank}`;
}

function roleOf(member) {
  const spec = member.details?.spec?.name;
  if (!spec) return null;
  if (TANK_SPECS.has(spec)) return "tank";
  if (HEALER_SPECS.has(spec)) return "healer";
  return "damage";
}

function timeAgo(iso) {
  if (!iso) return null;
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const steps = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return relativeFormat.format(Math.round(value), unit);
    value /= size;
  }
  return null;
}

function percent(value, max) {
  return `${Math.max(0, Math.min(100, max ? (value / max) * 100 : 0)).toFixed(1)}%`;
}

// ---------- Icons ----------

const ICON = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const PROFESSION_ICONS = {
  Mining: ICON('<path d="M3 8c5-5 13-5 18 0"/><path d="M12 5.5V21"/>'),
  Engineering: ICON('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  Alchemy: ICON('<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7 15h10"/>'),
  Herbalism: ICON('<path d="M5 21c0-9 5-15 15-16-1 10-7 15-15 16Z"/><path d="M5 21 14 12"/>'),
  Cooking: ICON('<path d="M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/><path d="M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3"/>'),
  Fishing: ICON('<path d="M12 2v11a4 4 0 1 1-4-4"/><path d="M8 9l-2 2"/>'),
  "First Aid": ICON('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>'),
  Tailoring: ICON('<path d="M19 5 6 18"/><circle cx="19.5" cy="4.5" r="1.5"/><path d="M6 18c-3 0-3 3 0 3s4-2 2-5"/>'),
  Enchanting: ICON('<path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/>'),
  Skinning: ICON('<path d="M4 20 15 9l3-6 3 3-6 3L4 20Z"/><path d="M4 20h5"/>'),
  Blacksmithing: ICON('<path d="M3 9h13l3-3v6h-3l-2 3H7z"/><path d="M8 15v5M14 15v5M6 20h10"/>'),
  Leatherworking: ICON('<path d="M5 3h14l-2 18H7z"/><path d="M9 7h6"/>'),
  Jewelcrafting: ICON('<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 21 8 9l4-6 4 6z"/>'),
  Inscription: ICON('<path d="M4 20 18 6l-2-2L2 18v2z"/><path d="M14 4l6 6"/>')
};
const DEFAULT_PROFESSION_ICON = ICON('<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>');
const ROLE_ICONS = {
  tank: ICON('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'),
  healer: ICON('<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>'),
  damage: ICON('<path d="M14 4h6v6L9 21l-6-6z"/><path d="M5 13l6 6"/>')
};
const ROLE_LABELS = { tank: "Tanks", healer: "Healers", damage: "Damage" };

function professionIcon(name) {
  return svgNode(PROFESSION_ICONS[name] || DEFAULT_PROFESSION_ICON);
}

// ---------- Generated portrait: silhouette by race + gender, weapon by class ----------

let portraitId = 0;

const WEAPONS = {
  1: '<path d="M38 26 L46 22 L150 168 L142 176 Z"/><path d="M52 64 L74 46 L80 52 L58 70 Z"/>',
  2: '<path d="M150 24 L158 30 L72 176 L64 170 Z"/><path d="M126 20 L168 44 L158 62 L116 38 Z"/>',
  3: '<path d="M42 30 C 4 90, 4 130, 42 190" fill="none" stroke-width="7"/><path d="M42 30 L42 190" fill="none" stroke-width="1.2"/>',
  4: '<path d="M30 112 L36 106 L84 150 L78 156 Z"/><path d="M170 112 L164 106 L116 150 L122 156 Z"/>',
  5: '<path d="M150 46 L156 46 L156 200 L150 200 Z"/><circle cx="153" cy="34" r="16" fill="none" stroke-width="3"/>',
  7: '<path d="M156 16 L162 18 L120 196 L114 194 Z"/><path d="M148 30 C 186 26, 196 64, 176 84 C 170 64, 160 54, 140 52 Z"/>',
  8: '<path d="M150 50 L156 50 L156 200 L150 200 Z"/><path d="M153 14 L166 34 L153 54 L140 34 Z"/>',
  9: '<path d="M44 56 L50 56 L50 200 L44 200 Z"/><circle cx="47" cy="40" r="14"/>',
  11: '<path d="M150 46 L156 46 L156 200 L150 200 Z"/><path d="M153 52 L134 26 M153 52 L172 24 M141 36 L130 38 M165 34 L178 36" fill="none" stroke-width="4"/>'
};
const ORBS = { 5: [153, 34], 8: [153, 34], 9: [47, 40] };

function raceKey(member) {
  const race = normalise(member.details?.race || member.race);
  if (race.includes("skyborne")) return "skyborne";
  if (race.includes("tauren")) return "tauren";
  if (race.includes("troll")) return "troll";
  if (race.includes("undead") || race.includes("forsaken")) return "undead";
  if (race.includes("orc")) return "orc";
  if (race.includes("elf")) return "elf";
  return "other";
}

function silhouette(race, female) {
  const head = { cx: 100, cy: 92, rx: female ? 21 : 24, ry: female ? 26 : 28 };
  let shoulders = female
    ? "M34 200 C 38 166, 58 146, 80 140 L 90 128 L 110 128 L 120 140 C 142 146, 162 166, 166 200 Z"
    : "M16 200 C 20 160, 46 140, 74 134 L 86 122 L 114 122 L 126 134 C 154 140, 180 160, 184 200 Z";
  let behind = "";
  let front = "";

  if (female) behind += '<path d="M76 94 C 72 58, 128 58, 124 94 L 132 156 L 116 146 L 100 156 L 84 146 L 68 156 Z"/>';

  switch (race) {
    case "orc":
      head.cy = 96; head.rx += 4;
      front += '<path d="M44 150 L 26 112 L 66 140 Z"/><path d="M156 150 L 174 112 L 134 140 Z"/>';
      break;
    case "undead":
      head.rx -= 3;
      shoulders = female
        ? "M42 200 C 46 168, 62 150, 82 142 L 92 130 L 108 130 L 118 142 C 138 150, 154 168, 158 200 Z"
        : "M28 200 C 32 166, 54 146, 78 138 L 88 126 L 112 126 L 122 138 C 146 146, 168 166, 172 200 Z";
      front += '<path d="M70 104 C 66 50, 134 50, 130 104 L 126 136 L 116 126 L 108 138 L 100 126 L 92 138 L 84 126 L 74 136 Z"/>';
      break;
    case "tauren":
      head.cy = 88; head.rx += 6; head.ry += 2;
      behind += '<path d="M76 74 C 50 72, 34 52, 40 26 C 48 46, 62 56, 84 60 Z"/><path d="M124 74 C 150 72, 166 52, 160 26 C 152 46, 138 56, 116 60 Z"/>';
      front += '<ellipse cx="100" cy="112" rx="18" ry="12"/>';
      break;
    case "troll":
      head.cy = 84; head.ry += 4; head.rx -= 2;
      behind += '<path d="M80 84 L 40 66 L 80 100 Z"/><path d="M120 84 L 160 66 L 120 100 Z"/><path d="M92 62 L 100 26 L 108 62 Z"/>';
      break;
    case "skyborne":
      behind += '<path d="M92 132 C 56 104, 18 84, 4 34 C 24 56, 36 60, 48 58 C 38 74, 42 82, 58 86 C 48 96, 56 102, 72 104 C 66 112, 76 118, 92 120 Z"/>'
        + '<path d="M108 132 C 144 104, 182 84, 196 34 C 176 56, 164 60, 152 58 C 162 74, 158 82, 142 86 C 152 96, 144 102, 128 104 C 134 112, 124 118, 108 120 Z"/>'
        + '<path d="M90 72 L 74 38 L 98 66 Z"/><path d="M100 66 L 100 30 L 106 64 Z"/><path d="M110 72 L 126 38 L 102 66 Z"/>';
      break;
    case "elf":
      behind += '<path d="M80 90 L 52 70 L 80 102 Z"/><path d="M120 90 L 148 70 L 120 102 Z"/>';
      break;
    default:
      break;
  }

  return { head, shoulders, behind, front };
}

function portraitSvg(member) {
  portraitId += 1;
  const id = `p${portraitId}`;
  const color = classColor(member);
  const race = raceKey(member);
  const gender = member.details?.gender;
  const female = gender === "FEMALE";
  const { head, shoulders, behind, front } = silhouette(race, female);
  const weapon = WEAPONS[member.classId] || "";
  const orb = ORBS[member.classId];
  const raceLabel = (member.details?.race || member.race || "").split(" ").pop().toUpperCase();
  const glowEyes = race === "undead" ? 1 : .8;
  const eyeY = head.cy + 2;
  const unknown = !gender;

  return svgNode(`
    <svg viewBox="0 0 200 200" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${female ? "Female" : unknown ? "Unknown" : "Male"} ${race} placeholder portrait">
      <defs>
        <radialGradient id="${id}g" cx="50%" cy="40%" r="62%">
          <stop offset="0" stop-color="${color}" stop-opacity=".55"/>
          <stop offset=".45" stop-color="#3a0c12" stop-opacity=".9"/>
          <stop offset="1" stop-color="#060405"/>
        </radialGradient>
        <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#140b0d"/><stop offset="1" stop-color="#040303"/>
        </linearGradient>
        <filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>
      </defs>
      <rect width="200" height="200" fill="url(#${id}g)"/>
      <circle cx="100" cy="80" r="58" fill="none" stroke="${color}" stroke-opacity=".16" stroke-width="1"/>
      <circle cx="100" cy="80" r="70" fill="none" stroke="${color}" stroke-opacity=".08" stroke-width="10" stroke-dasharray="2 9"/>
      <text x="100" y="196" text-anchor="middle" fill="${color}" fill-opacity=".1" font-family="LifeCraft, Impact, sans-serif" font-size="${raceLabel.length > 6 ? 44 : 62}" letter-spacing="2">${raceLabel}</text>
      <g fill="#100a0c" stroke="${color}" stroke-opacity=".55" stroke-width="2">${weapon}</g>
      ${orb ? `<circle cx="${orb[0]}" cy="${orb[1]}" r="9" fill="${color}" filter="url(#${id}f)"/><circle cx="${orb[0]}" cy="${orb[1]}" r="4" fill="#fff" fill-opacity=".85"/>` : ""}
      <g fill="url(#${id}b)" stroke="${color}" stroke-opacity=".38" stroke-width="1.4" stroke-linejoin="round">
        ${behind}
        <path d="${shoulders}"/>
        <rect x="${100 - head.rx * .45}" y="${head.cy + head.ry - 8}" width="${head.rx * .9}" height="26"/>
        <ellipse cx="${head.cx}" cy="${head.cy}" rx="${head.rx}" ry="${head.ry}"/>
        ${front}
      </g>
      ${unknown ? `<text x="100" y="${head.cy + 10}" text-anchor="middle" fill="${color}" fill-opacity=".75" font-family="'Barlow Condensed', 'Arial Narrow', sans-serif" font-weight="800" font-size="30">?</text>` : `
      <g fill="${color}" fill-opacity="${glowEyes}">
        <ellipse cx="${100 - head.rx * .38}" cy="${eyeY}" rx="4.2" ry="2.2" filter="url(#${id}f)"/>
        <ellipse cx="${100 + head.rx * .38}" cy="${eyeY}" rx="4.2" ry="2.2" filter="url(#${id}f)"/>
        <ellipse cx="${100 - head.rx * .38}" cy="${eyeY}" rx="2.2" ry="1.1" fill="#fff"/>
        <ellipse cx="${100 + head.rx * .38}" cy="${eyeY}" rx="2.2" ry="1.1" fill="#fff"/>
      </g>`}
    </svg>`);
}

const FALLBACK_BOX = { x: 560, y: 400, w: 480, h: 580, W: 1600, H: 1200 };
const RENDER_HOST = /^https:\/\/render\.worldofwarcraft\.com\//;

function renderUrl(member, key = "main") {
  const url = member.details?.render?.[key];
  return typeof url === "string" && RENDER_HOST.test(url) ? url : null;
}

// Positions Blizzard's 1600x1200 render so the figure fills a box of the given aspect (height / width).
function cropStyle(box, aspect) {
  const b = box && box.w > 0 && box.h > 0 ? box : FALLBACK_BOX;
  const W = b.W || 1600;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2 + b.h * 0.015;
  const spanW = Math.max(b.w * 1.3, (b.h * 1.12) / aspect);
  const spanH = spanW * aspect;
  return {
    width: `${(W / spanW) * 100}%`,
    left: `${(-(cx - spanW / 2) / spanW) * 100}%`,
    top: `${(-(cy - spanH / 2) / spanH) * 100}%`
  };
}

function renderLayer(member, { aspect = 1, className = "" } = {}) {
  const url = renderUrl(member);
  if (!url) return null;
  const race = (member.details?.race || member.race || "").split(" ").pop();
  const img = h("img", {
    class: "g-render__figure", src: url, alt: `${fullName(member)} in game`, loading: "lazy", decoding: "async",
    style: cropStyle(member.details.render.box, aspect)
  });
  const layer = h("div", { class: `g-render ${className}`.trim(), style: { "--cls": classColor(member) } },
    h("span", { class: "g-render__race", "aria-hidden": "true" }, race),
    h("span", { class: "g-render__floor", "aria-hidden": "true" }),
    img);
  img.addEventListener("error", () => layer.dispatchEvent(new CustomEvent("render-failed", { bubbles: true })), { once: true });
  return layer;
}

function customImage(member) {
  const custom = state.portraits.get(normalise(fullName(member)));
  if (!custom) return null;
  return h("img", { class: "g-art__custom", src: `assets/${encodeURIComponent(custom)}`, alt: `${fullName(member)}, ${member.className || "adventurer"}`, loading: "lazy" });
}

// Card/dialog art: custom portrait (with the in-game render revealed on hover), else the render, else a placeholder.
function buildArt(member, { aspect = 1 } = {}) {
  const custom = customImage(member);
  const render = renderLayer(member, { aspect, className: custom ? "g-render--reveal" : "" });
  const nodes = [];
  let kind = "placeholder";
  if (custom) {
    kind = "custom";
    custom.addEventListener("error", () => custom.replaceWith(render ? renderLayer(member, { aspect }) : portraitSvg(member)), { once: true });
    nodes.push(custom);
    if (render) {
      render.addEventListener("render-failed", () => render.remove(), { once: true });
      nodes.push(render, h("span", { class: "g-render__tag", "aria-hidden": "true" }, "IN-GAME"));
    }
  } else if (render) {
    kind = "render";
    render.addEventListener("render-failed", () => render.replaceWith(portraitSvg(member)), { once: true });
    nodes.push(render);
  } else {
    nodes.push(portraitSvg(member));
  }
  return { nodes, kind, dual: Boolean(custom && render) };
}

// ---------- Data loading ----------

async function loadJson(path, { optional = false } = {}) {
  try {
    const response = await fetch(path, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (optional) {
      console.warn(error.message);
      return null;
    }
    throw error;
  }
}

function validateGuild(data) {
  if (!data || typeof data !== "object" || !data.guild || !Array.isArray(data.members)) {
    throw new Error("guild.json is missing guild or member data.");
  }
  data.members = data.members.filter((member) => member && typeof member.name === "string" && member.name.trim());
  return data;
}

function readPortraits(roster) {
  const map = new Map();
  if (!Array.isArray(roster)) return map;
  for (const entry of roster) {
    if (entry && typeof entry.name === "string" && typeof entry.image === "string" && /^[\w][\w .-]*\.(?:jpe?g|png|webp)$/i.test(entry.image) && !entry.image.includes("..")) {
      map.set(normalise(entry.name), entry.image);
    }
  }
  return map;
}

// ---------- Hero + MOTD ----------

function renderHero(data) {
  const { guild, members } = data;
  const levels = members.map((m) => m.level).filter(Number.isFinite);
  const average = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 0;
  const created = guild.created ? new Date(guild.created) : null;
  const age = created ? Math.max(1, Math.ceil((Date.now() - created.getTime()) / 86400000)) : null;

  const nameParts = guild.name.split(" ");
  const tail = nameParts.length > 2 ? nameParts.slice(2).join(" ") : "";
  const title = $("#guildTitle");
  title.replaceChildren(nameParts.slice(0, tail ? 2 : nameParts.length).join(" "));
  if (tail) title.append(h("br"), h("em", {}, tail));
  document.title = `${guild.name} - Guild`;

  $("#heroOverline").textContent = ["GUILD DOSSIER", data.region, guild.faction, guild.ruleset && `${guild.ruleset} ruleset`].filter(Boolean).join(" · ").toUpperCase();
  const facts = [
    ["Members", numberFormat.format(guild.memberCount ?? members.length)],
    ["Avg level", average ? average.toFixed(1) : "—"],
    ["Founded", created ? dateFormat.format(created) : "—", age ? `DAY ${age}` : null],
    ["Ruleset", guild.ruleset || "—"]
  ];
  const ruleset = (data.rulesets || []).find((r) => r.id === guild.rulesetId) || (data.rulesets || []).find((r) => r.name === guild.ruleset);
  $("#heroFacts").replaceChildren(...facts.map(([label, value, small]) =>
    h("div", {}, h("dt", {}, label), h("dd", {}, value, small ? [" ", h("small", {}, small)] : null))));
  if (ruleset?.status) {
    const up = ruleset.status === "UP";
    const others = (data.rulesets || []).filter((r) => r !== ruleset).map((r) => `${r.name}: ${r.statusName || r.status}`).join(" · ");
    $("#heroFacts").append(h("div", { class: `g-status g-status--${up ? "up" : "down"}`, title: others ? `Other rulesets: ${others}` : null },
      h("dt", {}, "Server"), h("dd", {}, h("i", { "aria-hidden": "true" }), up ? "Online" : (ruleset.statusName || "Down"))));
  }
  renderCrest(guild.crest);
  const updated = data.generatedAt ? timeAgo(data.generatedAt) : null;
  $("#heroUpdated").textContent = updated ? `LEDGER UPDATED ${updated.toUpperCase()}` : "LEDGER UPDATED HOURLY";
}

function crestColor(color) {
  if (!color) return null;
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
  return `rgba(${clamp(color.r)}, ${clamp(color.g)}, ${clamp(color.b)}, ${Math.max(0, Math.min(1, Number(color.a ?? 1)))})`;
}

// In-game tabard: background colour, then border and emblem images tinted via CSS masks.
function renderCrest(crest) {
  const slot = $("#guildCrest");
  if (!slot || !crest?.emblem?.image || !crest?.border?.image) return;
  const safe = (url) => (typeof url === "string" && /^assets\/crest\/[\w-]+\.png$/.test(url) ? url : null);
  const emblem = safe(crest.emblem.image);
  const border = safe(crest.border.image);
  if (!emblem || !border) return;
  const layer = (url, color, cls) => h("span", { class: cls, style: { "--img": `url("${url}")`, "--tint": crestColor(color) || "#fff" } });
  slot.replaceChildren(
    h("span", { class: "g-crest__bg", style: { "--tint": crestColor(crest.background) || "#3a0c12" } }),
    layer(border, crest.border.color, "g-crest__layer"),
    layer(emblem, crest.emblem.color, "g-crest__layer"));
  slot.hidden = false;
  document.body.classList.add("has-crest");
}

function renderMotd(notes, data) {
  const motd = notes?.motd;
  const text = typeof motd?.text === "string" && motd.text.trim() ? motd.text.trim() : "No message of the day. Suspicious.";
  $("#motdText").textContent = text;
  const by = $("#motdBy");
  by.replaceChildren();
  if (motd?.author) by.append("— ", h("b", {}, motd.author));
  if (motd?.date) {
    const date = new Date(motd.date);
    if (!Number.isNaN(date.getTime())) by.append(motd.author ? " · " : "", dateFormat.format(date));
  }

  const top = [...data.members].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0];
  const pieces = [
    `${data.guild.memberCount ?? data.members.length} SUSPECTS ON THE BOOKS`,
    top ? `${fullName(top).toUpperCase()} LEADS THE RACE TO 60 AT LEVEL ${top.level}` : null,
    ...(Array.isArray(notes?.ticker) ? notes.ticker.filter((line) => typeof line === "string").slice(0, 2) : ["LOOT FIRST. ASK LATER."]),
    `${data.guild.faction?.toUpperCase() || "HORDE"} · ${data.region} · ${(data.guild.ruleset || "").toUpperCase()}`,
    ...(Array.isArray(notes?.ticker) ? notes.ticker.filter((line) => typeof line === "string").slice(2) : ["BANK TAB 2 IS NOT A FREE-FOR-ALL"])
  ].filter(Boolean).map((piece) => piece.toUpperCase());
  const ticker = $("#motdTicker");
  ticker.replaceChildren(...[...pieces, ...pieces].flatMap((piece) => [piece, h("b", {}, "✳")]));
}

// ---------- Roster ----------

function renderChips() {
  const counts = new Map();
  for (const member of state.members) {
    const key = member.classId ?? "?";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const chips = [h("button", { type: "button", class: "g-chip", "data-filter": "all", "aria-pressed": "true" }, h("i"), "All", h("b", {}, state.members.length))];
  [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([classId, count]) => {
    const sample = state.members.find((m) => (m.classId ?? "?") === classId);
    chips.push(h("button", {
      type: "button", class: "g-chip", "data-filter": String(classId), "aria-pressed": "false",
      style: { "--cls": CLASS_COLORS[classId] || "#f02025" }
    }, h("i"), sample?.className || "Unknown", h("b", {}, count)));
  });
  const container = $("#classChips");
  container.replaceChildren(...chips);
  container.addEventListener("click", (event) => {
    const chip = event.target.closest(".g-chip");
    if (!chip) return;
    state.filter = chip.dataset.filter;
    container.querySelectorAll(".g-chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    renderGrid();
  });
}

function sortedMembers() {
  const search = normalise(state.search);
  const list = state.members.filter((member) => {
    if (state.filter !== "all" && String(member.classId ?? "?") !== state.filter) return false;
    if (!search) return true;
    const haystack = normalise([
      fullName(member), member.className, member.race, member.details?.spec?.name, rankName(member.rank),
      ...(member.details?.professions || []).map((p) => p.name)
    ].join(" "));
    return haystack.includes(search);
  });
  const byName = (a, b) => fullName(a).localeCompare(fullName(b));
  const sorters = {
    level: (a, b) => (b.level ?? 0) - (a.level ?? 0) || byName(a, b),
    rank: (a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (b.level ?? 0) - (a.level ?? 0),
    name: byName,
    seen: (a, b) => (new Date(b.details?.lastLogin || 0)) - (new Date(a.details?.lastLogin || 0)) || byName(a, b),
    ilvl: (a, b) => (b.details?.itemLevel ?? -1) - (a.details?.itemLevel ?? -1) || byName(a, b)
  };
  return list.sort(sorters[state.sort] || sorters.level);
}

function createCard(member, index) {
  const color = classColor(member);
  const details = member.details;
  const art_ = buildArt(member);
  const isGm = member.rank === 0;

  const art = h("div", { class: "g-card__art" },
    art_.nodes,
    h("span", { class: "g-card__lvl" }, h("b", {}, member.level ?? "?"), h("span", {}, "LVL")),
    member.rank !== undefined && member.rank <= 1 ? h("span", { class: `g-card__rank${isGm ? " g-card__rank--gm" : ""}` }, rankName(member.rank)) : null,
    h("span", { class: "g-card__ring", title: `Level ${member.level} of ${MAX_LEVEL}` }, h("span", { style: { "--p": percent(member.level ?? 0, MAX_LEVEL) } }))
  );

  const professions = (details?.professions || []).filter((p) => p.type === "primary");
  const body = h("div", { class: "g-card__body" },
    h("h3", { class: "g-card__name" }, member.name, member.surname ? [" ", h("small", {}, member.surname)] : null),
    h("span", { class: "g-card__class" }, details?.spec?.name ? `${details.spec.name} ` : "", member.className || "Unknown", h("span", {}, ` · ${(details?.race || member.race || "").replace(" Skyborne", "")}`)),
    details
      ? h("div", { class: "g-card__profs" }, professions.length
        ? professions.map((p) => h("span", { class: "g-pill", title: `${p.name} ${p.skill}/${p.max}` }, professionIcon(p.name), p.name, h("b", {}, p.skill)))
        : h("span", { class: "g-card__hidden" }, "No primary professions"))
      : h("span", { class: "g-card__hidden" }, "Profile appears at level 10"),
    h("div", { class: "g-card__meta" },
      h("span", {}, details?.lastLogin ? `Seen ${timeAgo(details.lastLogin)}` : "Not yet scouted"),
      h("span", {}, details?.itemLevel ? `ilvl ${details.itemLevel}` : rankName(member.rank)))
  );

  const trigger = h("button", {
    type: "button", class: "g-card__trigger", "aria-haspopup": "dialog",
    "aria-label": `${fullName(member)}, level ${member.level} ${member.className || ""}. View details.`,
    "data-slug": member.slug,
    onclick: () => openCharacter(member, trigger)
  }, art, body);

  return h("article", { class: `g-card g-card--${art_.kind}${art_.dual ? " g-card--dual" : ""}`, style: { "--cls": color, "--i": String(index) } }, trigger);
}

function renderGrid() {
  const list = sortedMembers();
  const grid = $("#rosterGrid");
  grid.replaceChildren(...list.map(createCard));
  const status = $("#rosterStatus");
  status.hidden = list.length > 0;
  status.textContent = list.length ? "" : "No one matches that. Check the alts.";
  const scouted = state.members.filter((m) => m.details).length;
  $("#rosterNote").textContent = `${list.length} OF ${state.members.length} SHOWN · ${scouted} FULL PROFILES`;
}

// ---------- Numbers ----------

function renderLadder() {
  const list = [...state.members].sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || fullName(a).localeCompare(fullName(b)));
  $("#levelLadder").replaceChildren(...list.map((member, index) => h("li", { style: { "--cls": classColor(member), "--i": String(index) } },
    h("span", { class: "g-ladder__who", title: fullName(member) }, fullName(member)),
    h("span", { class: "g-ladder__track" }, h("span", { style: { "--p": percent(member.level ?? 0, MAX_LEVEL) } })),
    h("span", { class: "g-ladder__lvl" }, member.level ?? "?")
  )));
  const panel = $("#levelLadder").parentElement;
  panel.querySelector(".g-ladder__scale")?.remove();
  panel.append(h("div", { class: "g-ladder__scale", "aria-hidden": "true" }, h("span"), h("span"),
    h("span", {}, ...[0, 10, 20, 30, 40, 50, 60].map((n) => h("span", {}, n))), h("span")));
}

function renderClasses() {
  const counts = new Map();
  state.members.forEach((m) => {
    const key = m.classId ?? "?";
    const entry = counts.get(key) || { name: m.className || "Unknown", count: 0, color: classColor(m) };
    entry.count += 1;
    counts.set(key, entry);
  });
  const entries = [...counts.values()].sort((a, b) => b.count - a.count);
  const stack = $("#classStack");
  stack.setAttribute("aria-label", entries.map((e) => `${e.count} ${e.name}`).join(", "));
  stack.replaceChildren(...entries.map((e) => h("span", { title: `${e.name}: ${e.count}`, style: { "--cls": e.color, "--n": String(e.count) } })));
  $("#classLegend").replaceChildren(...entries.map((e) => h("li", { style: { "--cls": e.color } }, h("i"), e.name, h("b", {}, e.count))));
}

function renderRoles() {
  const counts = { tank: [], healer: [], damage: [] };
  state.members.forEach((m) => {
    const role = roleOf(m);
    if (role) counts[role].push(m);
  });
  const unscouted = state.members.filter((m) => !roleOf(m)).length;
  $("#roleSplit").replaceChildren(...Object.entries(counts).map(([role, list]) => h("div", { class: "g-role" },
    svgNode(ROLE_ICONS[role]),
    h("b", {}, list.length),
    h("span", {}, ROLE_LABELS[role]),
    h("small", {}, list.map((m) => m.name).join(", ") || "Vacancy")
  )));
  const foot = $("#roleSplit").parentElement.querySelector(".g-panel__foot");
  foot.textContent = `Role inferred from the talent tree with the most points.${unscouted ? ` ${unscouted} not yet scouted (under level 10).` : ""}`;
}

function renderRaces() {
  const counts = new Map();
  state.members.forEach((m) => {
    const race = m.details?.race || m.race || "Unknown";
    counts.set(race, (counts.get(race) || 0) + 1);
  });
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = entries[0]?.[1] || 1;
  $("#raceBars").replaceChildren(...entries.map(([race, count]) => h("li", {},
    h("div", { class: "g-bars__row" }, h("span", {}, race), h("b", {}, count)),
    h("div", { class: "g-bars__track" }, h("span", { style: { "--p": percent(count, max) } }))
  )));
}

function renderTotals(data) {
  const scouted = state.members.filter((m) => m.details);
  const sum = (fn) => state.members.reduce((total, m) => total + (fn(m) || 0), 0);
  const totals = [
    ["Combined levels", sum((m) => m.level)],
    ["Quests done", sum((m) => m.details?.questsCompleted)],
    ["Professions", sum((m) => (m.details?.professions || []).filter((p) => p.type === "primary").length)],
    ["Recipes known", sum((m) => (m.details?.professions || []).reduce((t, p) => t + (p.recipes || 0), 0))],
    ["Honorable kills", sum((m) => m.details?.honorableKills)],
    ["Achievement pts", data.guild.achievementPoints ?? 0]
  ];
  $("#guildTotals").replaceChildren(...totals.map(([label, value]) => h("div", {}, h("dt", {}, label), h("dd", {}, numberFormat.format(value)))));
  if (!scouted.length) $("#guildTotals").append(h("p", { class: "g-panel__foot" }, "Totals fill in as members pass level 10."));
}

function renderRecords() {
  const scouted = state.members.filter((m) => m.details);
  const best = (list, score) => list.reduce((top, m) => (score(m) > (top ? score(top) : -Infinity) ? m : top), null);
  const records = [];
  const push = (label, member, value) => { if (member && value !== null && value !== undefined) records.push([label, member, value]); };

  const top = best(state.members, (m) => m.level ?? 0);
  push("Front-runner", top, `Lvl ${top?.level}`);
  const quester = best(scouted, (m) => m.details.questsCompleted ?? 0);
  push("Questmaster", quester, quester ? `${quester.details.questsCompleted} quests` : null);
  const geared = best(scouted, (m) => m.details.itemLevel ?? 0);
  push("Best dressed", geared, geared ? `ilvl ${geared.details.itemLevel}` : null);
  const crafters = scouted.flatMap((m) => (m.details.professions || []).filter((p) => p.type === "primary").map((p) => ({ m, p })));
  const crafter = crafters.sort((a, b) => b.p.skill - a.p.skill)[0];
  push("Master crafter", crafter?.m, crafter ? `${crafter.p.name} ${crafter.p.skill}` : null);
  const reps = scouted.flatMap((m) => (m.details.reputations || []).map((r) => ({ m, r })));
  const rep = reps.sort((a, b) => b.r.tier - a.r.tier || b.r.value - a.r.value)[0];
  push("Teacher's pet", rep?.m, rep ? `${rep.r.standing} · ${rep.r.faction}` : null);
  const recent = best(scouted.filter((m) => m.details.lastLogin), (m) => new Date(m.details.lastLogin).getTime());
  push("Last one out", recent, recent ? timeAgo(recent.details.lastLogin) : null);
  const healthiest = best(scouted.filter((m) => m.details.stats?.health), (m) => m.details.stats.health);
  push("Thickest skull", healthiest, healthiest ? `${numberFormat.format(healthiest.details.stats.health)} HP` : null);

  $("#guildRecords").replaceChildren(...records.map(([label, member, value]) => h("li", {},
    h("span", {}, label), h("b", { title: fullName(member) }, fullName(member)), h("i", {}, value))));
}

// ---------- Leaderboards ----------

const BOARDS = [
  { stat: "Total kills", title: "Body count", unit: ["kill", "kills"] },
  { stat: "Total Killing Blows", title: "Executioner", unit: ["killing blow", "killing blows"] },
  { stat: "Total deaths", title: "Floor inspector", unit: ["death", "deaths"] },
  { stat: "Deaths from falling", title: "Gravity tested", unit: ["fall", "falls"] },
  { stat: "Total 5-player dungeons entered", title: "Dungeon crawler", unit: ["dungeon", "dungeons"] },
  { stat: "Greed rolls made on loot", title: "Greed is good", unit: ["greed roll", "greed rolls"] },
  { stat: "Need rolls made on loot", title: "Needs it more", unit: ["need roll", "need rolls"] },
  { stat: "Critters killed", title: "Critter crusher", unit: ["critter", "critters"] },
  { stat: "Health potions consumed", title: "Potion addict", unit: ["potion", "potions"] },
  { stat: "Food eaten", title: "Snack attack", unit: ["meal", "meals"] },
  { stat: "Number of times hearthed", title: "Homesick", unit: ["hearth", "hearths"] },
  { stat: "Quests abandoned", title: "Commitment issues", unit: ["abandoned", "abandoned"] }
];

function statOf(member, name) {
  const value = member.details?.statistics?.values?.[name];
  return Number.isFinite(value) ? value : 0;
}

function avatar(member, size = "md") {
  const url = renderUrl(member, "avatar");
  const wrap = h("span", { class: `g-avatar g-avatar--${size}`, style: { "--cls": classColor(member) } }, member.name.slice(0, 1));
  if (url) {
    const img = h("img", { src: url, alt: "", loading: "lazy" });
    img.addEventListener("error", () => img.remove(), { once: true });
    wrap.append(img);
  }
  return wrap;
}

function renderLeaderboards() {
  const scouted = state.members.filter((m) => m.details?.statistics);
  const totalKills = scouted.reduce((t, m) => t + statOf(m, "Total kills"), 0);
  const totalDeaths = scouted.reduce((t, m) => t + statOf(m, "Total deaths"), 0);
  const dungeons = scouted.reduce((t, m) => t + statOf(m, "Total 5-player dungeons entered"), 0);
  $("#boardsHeadline").replaceChildren(
    ...[["Guild kills", numberFormat.format(totalKills)], ["Guild deaths", numberFormat.format(totalDeaths)],
      ["Kills per death", totalDeaths ? (totalKills / totalDeaths).toFixed(1) : "∞"], ["Dungeon runs", numberFormat.format(dungeons)]]
      .map(([label, value]) => h("div", {}, h("dt", {}, label), h("dd", {}, value))));

  const cards = BOARDS.map((board) => {
    const ranked = scouted.map((m) => ({ m, v: statOf(m, board.stat) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v);
    if (!ranked.length) return null;
    const [first, ...rest] = ranked;
    const total = ranked.reduce((t, r) => t + r.v, 0);
    return h("article", { class: "g-board", style: { "--cls": classColor(first.m) } },
      h("header", {}, h("span", { class: "g-panel__kicker" }, board.stat.toUpperCase()), h("h3", {}, board.title)),
      h("div", { class: "g-board__champ" },
        avatar(first.m, "lg"),
        h("div", { class: "g-board__champ-id" }, h("b", { title: fullName(first.m) }, fullName(first.m)), h("span", {}, `${numberFormat.format(first.v)} ${board.unit[first.v === 1 ? 0 : 1]}`)),
        h("span", { class: "g-board__crown", "aria-hidden": "true" }, "01")),
      h("ol", { class: "g-board__rest", start: "2" }, rest.slice(0, 3).map((r, i) => h("li", { style: { "--cls": classColor(r.m) } },
        h("span", { class: "g-board__pos" }, String(i + 2).padStart(2, "0")),
        avatar(r.m, "sm"),
        h("span", { class: "g-board__who" }, fullName(r.m)),
        h("b", {}, numberFormat.format(r.v)),
        h("em", { style: { "--p": percent(r.v, first.v) } })))),
      h("p", { class: "g-board__total" }, `Guild total ${numberFormat.format(total)} · ${ranked.length} contributor${ranked.length === 1 ? "" : "s"}`));
  }).filter(Boolean);

  const grid = $("#boardGrid");
  grid.replaceChildren(...cards);
  if (!cards.length) grid.append(h("div", { class: "g-empty" }, h("b", {}, "No tallies yet"), h("p", {}, "Statistics show up once members pass level 10.")));

  // Dungeon boss body count, summed across the guild.
  const bosses = new Map();
  scouted.forEach((m) => (m.details.statistics.bosses || []).forEach((entry) => {
    const key = `${entry.boss}|${entry.instance}`;
    if (!bosses.has(key)) bosses.set(key, { ...entry, kills: 0, who: [] });
    const item = bosses.get(key);
    item.kills += entry.kills;
    item.who.push(m);
  }));
  const list = [...bosses.values()].sort((a, b) => b.kills - a.kills || a.boss.localeCompare(b.boss));
  $("#bossList").replaceChildren(...(list.length ? list.map((item) => h("li", {},
    h("div", { class: "g-boss__name" }, h("b", {}, item.boss), h("span", {}, item.instance)),
    h("div", { class: "g-boss__who" }, item.who.map((m) => avatar(m, "xs"))),
    h("strong", {}, `×${item.kills}`))) : [h("li", { class: "g-boss__none" }, "No dungeon bosses down yet.")]));
}

// ---------- Crafting directory ----------

function renderCrafting() {
  const byProfession = new Map();
  state.members.forEach((m) => (m.details?.professions || []).forEach((p) => {
    if (!byProfession.has(p.name)) byProfession.set(p.name, { type: p.type, list: [] });
    byProfession.get(p.name).list.push({ m, p });
  }));
  const entries = [...byProfession.entries()].sort((a, b) =>
    (a[1].type === b[1].type ? 0 : a[1].type === "primary" ? -1 : 1) || b[1].list.length - a[1].list.length || a[0].localeCompare(b[0]));
  const grid = $("#craftGrid");
  if (!entries.length) {
    grid.replaceChildren(h("div", { class: "g-empty" }, h("b", {}, "No crafters yet"), h("p", {}, "Professions show up once members pass level 10.")));
    return;
  }
  grid.replaceChildren(...entries.map(([name, { type, list }]) => h("article", { class: "g-craft" },
    h("header", {}, professionIcon(name), h("h3", {}, name), h("span", {}, type === "primary" ? `${list.length} CRAFTER${list.length === 1 ? "" : "S"}` : "SECONDARY")),
    h("ul", {}, list.sort((a, b) => b.p.skill - a.p.skill).slice(0, CRAFT_LIMIT).map(({ m, p }) => h("li", { style: { "--cls": classColor(m) } },
      h("span", {}, h("i"), fullName(m)),
      h("b", {}, `${p.skill} / ${p.max}`),
      h("em", { style: { "--p": percent(p.skill, p.max) } })
    ))),
    list.length > CRAFT_LIMIT ? h("p", { class: "g-craft__more" }, `+ ${list.length - CRAFT_LIMIT} more dabbling`) : null
  )));
}

// ---------- Deeds ----------

function renderDeeds(data) {
  const activity = Array.isArray(data.activity) ? data.activity : [];
  const recent = Array.isArray(data.achievements?.recent) ? data.achievements.recent : [];
  const body = $("#deedsBody");
  const feed = (items, render) => h("ol", { class: "g-feed" }, items.map(render));

  const left = activity.length
    ? feed(activity, (item) => h("li", {}, h("span", {}, `${item.type}${item.date ? ` · ${dateFormat.format(new Date(item.date))}` : ""}`), h("b", {}, item.title), item.who ? h("i", {}, item.who) : null))
    : h("div", { class: "g-empty" }, h("b", {}, "Nothing on the record yet"), h("p", {}, "Blizzard hasn't logged any guild activity so far. Boss kills and achievements land here as they happen. Act natural."));
  const right = recent.length
    ? feed(recent, (item) => h("li", {}, h("span", {}, item.date ? dateFormat.format(new Date(item.date)) : "Achievement"), h("b", {}, item.name)))
    : h("div", { class: "g-empty" },
      h("b", {}, `${numberFormat.format(data.achievements?.points ?? data.guild.achievementPoints ?? 0)} achievement points`),
      h("p", {}, "Guild achievements unlock as the crew levels, raids and crafts together. First one gets bragging rights."));
  body.replaceChildren(left, right);
  $("#deedsNote").textContent = `${activity.length} ACTIVITY · ${data.achievements?.total ?? 0} ACHIEVEMENTS`;
}

// ---------- Character sheet dialog ----------

const dialog = $("#charDialog");
const dialogPanel = dialog.querySelector(".g-dialog__panel");
const sheetBody = $("#charBody");
let dialogTrigger = null;
let closeTimer = null;

const SLOT_TYPES = {
  Head: "HEAD", Neck: "NECK", Shoulders: "SHOULDER", Shoulder: "SHOULDER", Back: "BACK", Chest: "CHEST", Shirt: "SHIRT",
  Tabard: "TABARD", Wrist: "WRIST", Hands: "HANDS", Waist: "WAIST", Legs: "LEGS", Feet: "FEET", "Ring 1": "FINGER_1",
  "Ring 2": "FINGER_2", "Trinket 1": "TRINKET_1", "Trinket 2": "TRINKET_2", "Main Hand": "MAIN_HAND", "Off Hand": "OFF_HAND",
  Ranged: "RANGED", Ammo: "AMMO"
};
const SLOT_LABELS = {
  HEAD: "Head", NECK: "Neck", SHOULDER: "Shoulder", BACK: "Back", CHEST: "Chest", SHIRT: "Shirt", TABARD: "Tabard", WRIST: "Wrist",
  HANDS: "Hands", WAIST: "Waist", LEGS: "Legs", FEET: "Feet", FINGER_1: "Finger", FINGER_2: "Finger", TRINKET_1: "Trinket",
  TRINKET_2: "Trinket", MAIN_HAND: "Main Hand", OFF_HAND: "Off Hand", RANGED: "Ranged", AMMO: "Ammo"
};
const DOLL_LEFT = ["HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "SHIRT", "TABARD", "WRIST"];
const DOLL_RIGHT = ["HANDS", "WAIST", "LEGS", "FEET", "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2"];
const DOLL_BOTTOM = ["MAIN_HAND", "OFF_HAND", "RANGED"];
const RESISTANCES = [["arcane", "Arcane", "#d5a6ff"], ["fire", "Fire", "#ff7a3d"], ["nature", "Nature", "#5fd35f"], ["frost", "Frost", "#7fd0ff"], ["shadow", "Shadow", "#a77bd9"]];
const SHEET_TABS = [["character", "Character"], ["stats", "Stats"], ["bosses", "Bosses"], ["recipes", "Recipes"], ["achievements", "Achievements"], ["reputation", "Reputation"]];

function iconUrl(url) {
  return typeof url === "string" && RENDER_HOST.test(url) ? url : null;
}

function fmt(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${typeof value === "number" ? numberFormat.format(value) : value}${suffix}`;
}

function block(title, ...content) {
  return h("section", { class: "g-block" }, h("h4", {}, title), ...content);
}

function emptyNote(title, text) {
  return h("div", { class: "g-empty g-empty--sheet" }, h("b", {}, title), h("p", {}, text));
}

// ----- Character tab: the in-game paper doll -----

function itemTooltip(item, id) {
  const tip = item.tip || {};
  const row = (left, right) => (left || right ? h("span", { class: "g-tip__row" }, h("span", {}, left || ""), h("span", {}, right || "")) : null);
  const quality = item.quality || "COMMON";
  return h("span", { class: "g-tip", role: "tooltip", id },
    h("b", { class: `g-tip__name q-${quality} g-q-${quality}` }, item.name),
    tip.bind ? h("span", {}, tip.bind) : null,
    row(tip.type, tip.sub),
    row(tip.damage, tip.speed),
    tip.dps ? h("span", {}, tip.dps) : null,
    tip.armor ? h("span", {}, tip.armor) : null,
    (tip.stats || []).filter((s) => !s.g).map((s) => h("span", {}, s.t)),
    (tip.enchants || []).map((text) => h("span", { class: "g-tip__green" }, text)),
    tip.durability ? h("span", {}, tip.durability) : null,
    tip.req ? h("span", {}, tip.req) : null,
    (tip.stats || []).filter((s) => s.g).map((s) => h("span", { class: "g-tip__green" }, `Equip: ${s.t}`)),
    (tip.spells || []).map((text) => h("span", { class: "g-tip__green" }, text)),
    tip.set ? h("span", { class: "g-tip__set" }, tip.set) : null,
    tip.desc ? h("span", { class: "g-tip__desc" }, `“${tip.desc}”`) : null,
    item.level ? h("span", { class: "g-tip__ilvl" }, `Item Level ${item.level}`) : null,
    itemSource(item));
}

function slotLabel(label) {
  return h("span", { class: "g-slot__label", "aria-hidden": "true" }, label);
}

function gearSlot(type, item, side) {
  const label = SLOT_LABELS[type] || type;
  if (!item) {
    return h("div", { class: `g-slot g-slot--empty g-slot--${side}`, title: `${label}: empty` },
      slotLabel(label), h("span", { class: "visually-hidden" }, `${label}: empty`));
  }
  const tipId = `tip-${type.toLowerCase()}`;
  const icon = iconUrl(state.catalog.items?.[item.id]);
  const quality = (item.quality || "COMMON").toLowerCase();
  const img = icon ? h("img", { src: icon, alt: "", loading: "lazy", decoding: "async" }) : null;
  img?.addEventListener("error", () => img.replaceWith(slotLabel(label)), { once: true });
  const button = h("button", {
    type: "button", class: "g-slot__btn", "aria-describedby": tipId, "aria-expanded": "false",
    "aria-label": `${label}: ${item.name}. Click to pin details.`
  }, img || slotLabel(label));
  const slot = h("div", { class: `g-slot g-slot--${side} g-slot--${quality}` }, button, itemTooltip(item, tipId));
  // Hover previews the tooltip; a click pins it open so the source link can be clicked (and works on touch).
  button.addEventListener("click", () => {
    const open = !slot.classList.contains("is-open");
    closePinnedSlots();
    slot.classList.toggle("is-open", open);
    button.setAttribute("aria-expanded", String(open));
  });
  return slot;
}

function closePinnedSlots() {
  sheetBody.querySelectorAll(".g-slot.is-open").forEach((node) => {
    node.classList.remove("is-open");
    node.querySelector(".g-slot__btn")?.setAttribute("aria-expanded", "false");
  });
}

sheetBody.addEventListener("click", (event) => {
  if (!event.target.closest(".g-slot")) closePinnedSlots();
});

// Recipe name -> guild members who know it, so crafted gear can say who makes it.
function crafterIndex() {
  const index = new Map();
  for (const member of state.members) {
    for (const profession of member.details?.professions || []) {
      for (const recipe of profession.known || []) {
        const key = normalise(recipe);
        if (!index.has(key)) index.set(key, { profession: profession.name, members: [] });
        index.get(key).members.push(member);
      }
    }
  }
  return index;
}

function itemSource(item) {
  const crafted = state.crafters.get(normalise(item.name));
  const onWowhead = item.id && state.catalog.wowhead?.[item.id] === true;
  const lines = [];
  if (crafted) {
    const names = crafted.members.slice(0, 3).map((m) => m.name).join(", ");
    const more = crafted.members.length > 3 ? ` +${crafted.members.length - 3}` : "";
    lines.push(h("span", {}, h("b", {}, `Crafted · ${crafted.profession}`), h("span", { class: "g-tip__muted" }, ` In the guild: ${names}${more}`)));
  }
  if (onWowhead) {
    lines.push(h("a", { class: "g-tip__link", href: `https://www.wowhead.com/classic/item=${encodeURIComponent(item.id)}`, target: "_blank", rel: "noopener noreferrer" },
      "Drops, vendors & quests on Wowhead ↗"));
  } else if (!crafted) {
    lines.push(h("span", { class: "g-tip__muted" }, state.catalog.wowhead && item.id in state.catalog.wowhead
      ? "Forever-only item. No public database lists where it drops yet."
      : "Source lookup arrives with the next data refresh."));
  }
  return h("span", { class: "g-tip__source" }, h("span", { class: "g-tip__head" }, "Where it's from"), lines);
}

function attrRow(label, pair, suffix = "") {
  if (pair === null || pair === undefined) return null;
  const [base, effective] = Array.isArray(pair) ? pair : [pair, pair];
  const boosted = effective > base;
  return h("div", { class: "g-attr" }, h("dt", {}, label),
    h("dd", { class: boosted ? "is-boosted" : null, title: boosted ? `${base} base + ${effective - base}` : null }, fmt(effective, suffix)));
}

function damageRange(min, max) {
  return Number.isFinite(min) && Number.isFinite(max) ? `${Math.round(min)} – ${Math.round(max)}` : null;
}

function combatRows(stats, mode) {
  const melee = stats.melee || {};
  const ranged = stats.ranged || {};
  const spell = stats.spell || {};
  const rows = {
    melee: [["Damage", damageRange(melee.min, melee.max)], ["Speed", melee.speed], ["DPS", melee.dps ?? stats.dps], ["Power", stats.attackPower],
      ["Hit", melee.hit, "%"], ["Crit", melee.crit ?? stats.crit, "%"]],
    ranged: [["Damage", damageRange(ranged.min, ranged.max)], ["Power", ranged.ap], ["Hit", ranged.hit, "%"], ["Crit", ranged.crit, "%"]],
    spell: [["Damage", stats.spellPower], ["Healing", spell.healing], ["Hit", spell.hit, "%"], ["Crit", spell.crit, "%"],
      ["Regen", spell.regen], ["Haste", spell.haste, "%"]]
  }[mode];
  return rows.filter(([, value]) => value !== null && value !== undefined)
    .map(([label, value, suffix]) => h("div", { class: "g-attr" }, h("dt", {}, label), h("dd", {}, fmt(value, suffix))));
}

function defaultCombatMode(member) {
  if (member.classId === 3) return "ranged";
  if ([5, 8, 9].includes(member.classId) || roleOf(member) === "healer") return "spell";
  return "melee";
}

function statBoxes(member) {
  const stats = member.details.stats || {};
  const a = stats.attributes;
  const base = h("dl", { class: "g-statbox" },
    a ? [attrRow("Strength", a.strength), attrRow("Agility", a.agility), attrRow("Stamina", a.stamina),
      attrRow("Intellect", a.intellect), attrRow("Spirit", a.spirit), attrRow("Armor", a.armor)]
      : [attrRow("Health", stats.health), attrRow(stats.powerType || "Power", stats.power), attrRow("Crit", stats.crit, "%"), attrRow("Dodge", stats.dodge, "%")]);

  let mode = defaultCombatMode(member);
  const list = h("dl", { class: "g-statbox__list" });
  const switcher = h("div", { class: "g-statbox__modes", role: "group", "aria-label": "Combat stats" });
  const draw = () => {
    list.replaceChildren(...combatRows(stats, mode));
    switcher.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  };
  ["melee", "ranged", "spell"].forEach((m) => switcher.append(h("button", {
    type: "button", "data-mode": m, onclick: () => { mode = m; draw(); }
  }, m)));
  draw();
  return h("div", { class: "g-doll__stats" }, base, h("div", { class: "g-statbox g-statbox--combat" }, switcher, list));
}

function resistanceBadges(stats) {
  const r = stats?.resistances;
  if (!r) return null;
  return h("ul", { class: "g-resists", "aria-label": "Resistances" }, RESISTANCES.map(([key, label, color]) =>
    h("li", { style: { "--res": color }, title: `${label} resistance` }, h("b", {}, r[key] ?? 0), h("span", {}, label.slice(0, 3)))));
}

function dollModel(member) {
  const fallback = () => h("div", { class: "g-doll__placeholder" }, portraitSvg(member));
  const model = renderLayer(member, { aspect: 1.15, className: "g-render--doll" });
  if (!model) return fallback();
  model.addEventListener("render-failed", () => model.replaceWith(fallback()), { once: true });
  // The model box is as wide as the space between the slot columns, so crop to its real shape.
  const figure = model.querySelector(".g-render__figure");
  if ("ResizeObserver" in window) {
    new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) Object.entries(cropStyle(member.details.render.box, height / width)).forEach(([prop, value]) => figure.style.setProperty(prop, value));
    }).observe(model);
  }
  return model;
}

function characterTab(member) {
  const details = member.details;
  const bySlot = new Map((details?.equipment || []).map((item) => [item.slotType || SLOT_TYPES[item.slot] || item.slot, item]));
  const bottom = bySlot.has("AMMO") ? [...DOLL_BOTTOM, "AMMO"] : DOLL_BOTTOM;

  const doll = h("div", { class: "g-doll" },
    h("div", { class: "g-doll__col g-doll__col--left" }, DOLL_LEFT.map((type) => gearSlot(type, bySlot.get(type), "left"))),
    h("div", { class: "g-doll__center" },
      h("div", { class: "g-doll__model" }, dollModel(member), resistanceBadges(details?.stats),
        details?.itemLevel ? h("span", { class: "g-doll__ilvl" }, h("b", {}, details.itemLevel), "ITEM LEVEL") : null),
      details ? statBoxes(member) : null),
    h("div", { class: "g-doll__col g-doll__col--right" }, DOLL_RIGHT.map((type) => gearSlot(type, bySlot.get(type), "right"))),
    h("div", { class: "g-doll__weapons" }, bottom.map((type) => gearSlot(type, bySlot.get(type), "bottom"))));

  const parts = [doll];
  if (!details) {
    parts.push(h("p", { class: "g-note" }, h("b", {}, "Not yet scouted. "),
      "Blizzard only publishes a character's profile once they reach level 10 and log out. Gear, stats, recipes and achievements appear here after that."));
    return parts;
  }
  const trees = details.spec?.trees || [];
  if (trees.some((t) => t.points)) {
    parts.push(block("Talents",
      h("div", { class: "g-trees" }, trees.filter((t) => t.points).map((tree, i) => h("span", { style: { "--n": String(tree.points), "--a": String(i === 0 ? 1 : .45) } }, tree.name))),
      h("div", { class: "g-trees__legend" }, trees.map((tree) => h("span", {}, `${tree.name} `, h("b", {}, tree.points))))));
  }
  if (details.titles?.length) parts.push(block("Titles", h("p", { class: "g-dialog__line" }, details.titles.join(" · "))));
  return parts;
}

// ----- Stats tab -----

function statCard(title, rows) {
  const items = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (!items.length) return null;
  return h("article", { class: "g-statcard" }, h("h5", {}, title), h("dl", {}, items.map(([label, value, suffix = "", boosted]) =>
    h("div", {}, h("dt", {}, label), h("dd", { class: boosted ? "is-boosted" : null }, fmt(value, suffix))))));
}

function statsTab(member) {
  const d = member.details;
  const s = d.stats || {};
  const a = s.attributes || {};
  const m = s.melee || {};
  const r = s.ranged || {};
  const sp = s.spell || {};
  const v = d.statistics?.values || {};
  const eff = (pair) => (pair ? pair[1] : null);
  const up = (pair) => Boolean(pair && pair[1] > pair[0]);

  const cards = [
    statCard("Vitals", [["Health", s.health], [s.powerType || "Power", s.power], ["Item level", d.itemLevel], ["Move speed", s.speed, "%"]]),
    statCard("Attributes", [["Strength", eff(a.strength), "", up(a.strength)], ["Agility", eff(a.agility), "", up(a.agility)], ["Stamina", eff(a.stamina), "", up(a.stamina)],
      ["Intellect", eff(a.intellect), "", up(a.intellect)], ["Spirit", eff(a.spirit), "", up(a.spirit)]]),
    statCard("Melee", [["Damage", damageRange(m.min, m.max)], ["Speed", m.speed], ["DPS", m.dps ?? s.dps], ["Attack power", s.attackPower], ["Hit", m.hit, "%"], ["Crit", m.crit ?? s.crit, "%"], ["Haste", m.haste, "%"]]),
    statCard("Ranged", [["Damage", damageRange(r.min, r.max)], ["Attack power", r.ap], ["Hit", r.hit, "%"], ["Crit", r.crit, "%"], ["Haste", r.haste, "%"]]),
    statCard("Spell", [["Bonus damage", s.spellPower], ["Bonus healing", sp.healing], ["Hit", sp.hit, "%"], ["Crit", sp.crit, "%"], ["Haste", sp.haste, "%"],
      ["Penetration", sp.penetration], ["Mana regen", sp.regen], ["Regen in combat", sp.regenCombat]]),
    statCard("Defense", [["Armor", eff(a.armor), "", up(a.armor)], ["Defense", eff(a.defense)], ["Dodge", s.dodge, "%"], ["Parry", s.parry, "%"], ["Block", s.block, "%"]]),
    s.resistances ? statCard("Resistances", RESISTANCES.map(([key, label]) => [label, s.resistances[key]])) : null,
    statCard("Record", [["Quests done", d.questsCompleted], ["Honorable kills", d.honorableKills], ["Total kills", v["Total kills"]], ["Deaths", v["Total deaths"]],
      ["Mounts", d.mounts], ["Pets", d.pets], ["Achievement pts", d.achievements?.points ?? d.achievementPoints]])
  ].filter(Boolean);

  const parts = [h("div", { class: "g-statgrid" }, cards)];
  if (!s.attributes) parts.push(h("p", { class: "g-panel__foot" }, "The full stat sheet fills in with the next data refresh."));

  const values = d.statistics?.values;
  if (values && Object.keys(values).length) {
    const groups = Array.isArray(d.statistics.groups) && d.statistics.groups.length
      ? d.statistics.groups
      : [{ name: "All statistics", stats: Object.keys(values) }];
    parts.push(block("Game statistics", h("div", { class: "g-gamestats" }, groups.map((group, index) => h("details", { class: "g-gamestat", open: index < 2 },
      h("summary", {}, group.name, h("b", {}, group.stats.length)),
      h("dl", {}, group.stats.filter((name) => name in values).map((name) => h("div", {}, h("dt", {}, name), h("dd", {}, fmt(values[name]))))))))));
  }
  return parts;
}

// ----- Bosses tab -----

const RAIDS = new Set(["Molten Core", "Onyxia's Lair", "Blackwing Lair", "Zul'Gurub", "Ruins of Ahn'Qiraj", "Temple of Ahn'Qiraj", "Ahn'Qiraj Temple", "Naxxramas"]);
// Rough level order, so dungeons read like a levelling journey. Unknown (Forever-only) ones go last.
const DUNGEON_ORDER = ["Ragefire Chasm", "Wailing Caverns", "Deadmines", "The Deadmines", "Shadowfang Keep", "Blackfathom Deeps", "The Stockade", "Stormwind Stockade",
  "Gnomeregan", "Razorfen Kraul", "Scarlet Monastery", "Razorfen Downs", "Uldaman", "Zul'Farrak", "Maraudon", "Sunken Temple", "Temple of Atal'Hakkar",
  "Blackrock Depths", "Lower Blackrock Spire", "Upper Blackrock Spire", "Blackrock Spire", "Dire Maul", "Stratholme", "Scholomance",
  "Zul'Gurub", "Molten Core", "Onyxia's Lair", "Blackwing Lair", "Ruins of Ahn'Qiraj", "Temple of Ahn'Qiraj", "Ahn'Qiraj Temple", "Naxxramas"];

function instanceCard(name, bosses) {
  const kills = bosses.reduce((t, b) => t + b.kills, 0);
  const top = Math.max(...bosses.map((b) => b.kills));
  return h("article", { class: "g-instance" },
    h("header", {}, h("h5", {}, name), h("span", {}, `${bosses.length} boss${bosses.length === 1 ? "" : "es"} · ${numberFormat.format(kills)} kill${kills === 1 ? "" : "s"}`)),
    h("ol", {}, bosses.map((b) => h("li", {},
      h("span", {}, b.boss),
      h("b", {}, `×${numberFormat.format(b.kills)}`),
      h("em", { style: { "--p": percent(b.kills, top) } })))));
}

function bossesTab(member) {
  const stats = member.details.statistics;
  const bosses = Array.isArray(stats?.bosses) ? stats.bosses.filter((b) => b && b.boss && b.instance && b.kills > 0) : [];
  const values = stats?.values || {};
  const byInstance = new Map();
  bosses.forEach((b) => {
    if (!byInstance.has(b.instance)) byInstance.set(b.instance, []);
    byInstance.get(b.instance).push(b);
  });
  const rank = (name) => {
    const i = DUNGEON_ORDER.indexOf(name);
    return i < 0 ? DUNGEON_ORDER.length : i;
  };
  const instances = [...byInstance.entries()]
    .map(([name, list]) => [name, list.sort((a, b) => b.kills - a.kills || a.boss.localeCompare(b.boss))])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  const raids = instances.filter(([name]) => RAIDS.has(name));
  const dungeons = instances.filter(([name]) => !RAIDS.has(name));
  const total = bosses.reduce((t, b) => t + b.kills, 0);
  const favourite = bosses.reduce((top, b) => (!top || b.kills > top.kills ? b : top), null);

  const head = h("dl", { class: "g-sheet__summary" },
    h("div", {}, h("dt", {}, "Bosses down"), h("dd", {}, fmt(bosses.length))),
    h("div", {}, h("dt", {}, "Boss kills"), h("dd", {}, fmt(total))),
    h("div", {}, h("dt", {}, "Dungeons entered"), h("dd", {}, fmt(values["Total 5-player dungeons entered"] ?? 0))),
    h("div", {}, h("dt", {}, "Dungeon deaths"), h("dd", {}, fmt(values["Total deaths in 5-player dungeons"] ?? 0))),
    favourite ? h("div", {}, h("dt", {}, "Most farmed"), h("dd", { class: "g-sheet__small" }, `${favourite.boss} ×${favourite.kills}`)) : null);

  if (!stats) return [head, emptyNote("No tally yet", "Boss kills fill in with the next data refresh.")];
  return [head,
    block("Dungeons", dungeons.length
      ? h("div", { class: "g-instances" }, dungeons.map(([name, list]) => instanceCard(name, list)))
      : emptyNote("No dungeon bosses", "Not a single dungeon boss down. Ragefire Chasm is right there.")),
    block("Raids", raids.length
      ? h("div", { class: "g-instances" }, raids.map(([name, list]) => instanceCard(name, list)))
      : emptyNote("No raid bosses yet", "Molten Core waits. Bring fire resistance and forty friends."))];
}

// ----- Recipes tab -----

function recipesTab(member) {
  const professions = member.details.professions || [];
  if (!professions.length) return [emptyNote("No trade", "No professions learned yet. Pure freeloader energy.")];
  const total = professions.reduce((t, p) => t + (p.known?.length ?? p.recipes ?? 0), 0);
  const search = h("input", { type: "search", placeholder: "Search recipes…", autocomplete: "off" });
  const sections = professions.map((p) => {
    const known = Array.isArray(p.known) ? p.known : null;
    const list = known?.length ? h("ul", { class: "g-recipes__list" }, known.map((name) => h("li", { "data-name": normalise(name) }, name))) : null;
    const section = h("section", { class: "g-recipes__prof" },
      h("header", { class: "g-prof" },
        professionIcon(p.name),
        h("span", {}, p.name, h("small", {}, p.type)),
        h("b", {}, `${p.skill} / ${p.max}`),
        h("em", { style: { "--p": percent(p.skill, p.max) } })),
      h("p", { class: "g-recipes__count" }, `${known?.length ?? p.recipes ?? 0} known`),
      list || h("p", { class: "g-panel__foot" }, known ? "No recipes for this one." : "Recipe names fill in with the next data refresh."));
    return { section, list };
  });
  const none = h("p", { class: "g-recipes__none", hidden: true }, "No recipe matches that.");
  search.addEventListener("input", () => {
    const query = normalise(search.value);
    let shown = 0;
    sections.forEach(({ section, list }) => {
      if (!list) {
        section.hidden = Boolean(query);
        return;
      }
      let hits = 0;
      list.querySelectorAll("li").forEach((li) => {
        const match = !query || li.dataset.name.includes(query);
        li.hidden = !match;
        if (match) hits += 1;
      });
      section.hidden = Boolean(query) && !hits;
      shown += hits;
    });
    none.hidden = !query || shown > 0;
  });
  return [
    h("div", { class: "g-sheet__toolbar" },
      h("p", {}, h("b", {}, numberFormat.format(total)), ` recipe${total === 1 ? "" : "s"} across ${professions.length} skill${professions.length === 1 ? "" : "s"}`),
      h("label", { class: "g-search" }, h("span", { class: "visually-hidden" }, "Search recipes"), search)),
    h("div", { class: "g-recipes" }, sections.map((s) => s.section)),
    none
  ];
}

// ----- Achievements tab -----

function achievementsTab(member) {
  const data = member.details.achievements;
  const titles = member.details.titles || [];
  const head = h("dl", { class: "g-sheet__summary" },
    h("div", {}, h("dt", {}, "Completed"), h("dd", {}, fmt(data?.list?.length ?? 0))),
    h("div", {}, h("dt", {}, "Points"), h("dd", {}, fmt(data?.points ?? member.details.achievementPoints ?? 0))),
    h("div", {}, h("dt", {}, "Titles"), h("dd", {}, fmt(titles.length))));
  if (!data) return [head, emptyNote("Ledger pending", "Achievements fill in with the next data refresh.")];
  if (!data.list?.length) return [head, emptyNote("Clean record", "Nothing earned yet. Everyone starts somewhere, usually face-down in Durotar.")];
  const catalog = state.catalog.achievements || {};
  return [head,
    titles.length ? h("p", { class: "g-dialog__line g-sheet__titles" }, h("b", {}, "Titles: "), titles.join(" · ")) : null,
    h("ol", { class: "g-achievements" }, data.list.map((entry) => {
      const info = catalog[entry.id] || {};
      const icon = iconUrl(info.icon);
      const img = icon ? h("img", { src: icon, alt: "", loading: "lazy" }) : null;
      img?.addEventListener("error", () => img.replaceWith("✳"), { once: true });
      return h("li", {},
        h("span", { class: "g-ach__icon", "aria-hidden": "true" }, img || "✳"),
        h("div", { class: "g-ach__text" },
          h("b", {}, entry.name),
          info.description ? h("p", {}, info.description) : null,
          info.reward ? h("p", { class: "g-ach__reward" }, info.reward) : null),
        h("div", { class: "g-ach__meta" },
          info.category ? h("span", {}, info.category) : null,
          entry.date ? h("time", { datetime: entry.date }, dateFormat.format(new Date(entry.date))) : null,
          info.points ? h("b", {}, `${info.points} pts`) : null));
    }))];
}

// ----- Reputation tab -----

function reputationTab(member) {
  const reps = member.details.reputations || [];
  if (!reps.length) return [emptyNote("Nobody knows them", "No faction standings on record yet.")];
  return [h("div", { class: "g-reps g-reps--sheet" }, reps.map((rep) => h("div", { class: "g-rep" },
    h("span", {}, rep.faction),
    h("b", {}, rep.standing, rep.max ? h("small", {}, ` ${numberFormat.format(rep.value)} / ${numberFormat.format(rep.max)}`) : null),
    h("em", { style: { "--p": percent(rep.value, rep.max), "--rep": REP_COLORS[rep.standing] || "#2fa84f" } }))))];
}

// ----- Tabs + open/close -----

const TAB_BUILDERS = { character: characterTab, stats: statsTab, bosses: bossesTab, recipes: recipesTab, achievements: achievementsTab, reputation: reputationTab };
const tabList = $("#charTabs");

function selectTab(name, { focus = false } = {}) {
  tabList.querySelectorAll("[role=tab]").forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  });
  sheetBody.querySelectorAll("[role=tabpanel]").forEach((panel) => { panel.hidden = panel.dataset.tab !== name; });
  sheetBody.scrollTop = 0;
}

tabList.addEventListener("click", (event) => {
  const tab = event.target.closest("[role=tab]");
  if (tab) selectTab(tab.dataset.tab);
});
tabList.addEventListener("keydown", (event) => {
  const tabs = [...tabList.querySelectorAll("[role=tab]")];
  const index = tabs.indexOf(document.activeElement);
  if (index < 0) return;
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  selectTab(tabs[(index + step + tabs.length) % tabs.length].dataset.tab, { focus: true });
});

function sheetPortrait(member) {
  const custom = customImage(member);
  const wrap = h("span", { class: "g-sheet__portrait", style: { "--cls": classColor(member) } });
  if (custom) {
    custom.addEventListener("error", () => custom.replaceWith(avatar(member, "lg")), { once: true });
    wrap.append(custom);
  } else {
    wrap.append(avatar(member, "lg"));
  }
  wrap.append(h("span", { class: "g-sheet__lvl" }, member.level ?? "?"));
  return wrap;
}

function openCharacter(member, trigger) {
  const details = member.details;
  dialogTrigger = trigger;
  dialogPanel.style.setProperty("--cls", classColor(member));

  $("#charPortrait").replaceChildren(sheetPortrait(member));
  $("#charRank").textContent = [rankName(member.rank), state.guildName].filter(Boolean).join(" · ");
  $("#charName").textContent = fullName(member);
  const gender = details?.gender ? `${details.gender[0]}${details.gender.slice(1).toLowerCase()} ` : "";
  $("#charLine").replaceChildren(`Level ${member.level ?? "?"} ${details?.spec?.name ? `${details.spec.name} ` : ""}${gender}${details?.race || member.race || ""} `,
    h("b", {}, member.className || ""));
  $("#charSeen").textContent = details?.lastLogin ? `Last seen ${timeAgo(details.lastLogin)}${member.detailsStale ? " · cached" : ""}` : "Not yet scouted";

  const tabs = details ? SHEET_TABS : SHEET_TABS.slice(0, 1);
  tabList.hidden = tabs.length < 2;
  tabList.replaceChildren(...tabs.map(([name, label]) => h("button", {
    type: "button", role: "tab", id: `charTab-${name}`, "aria-controls": `charPanel-${name}`, "data-tab": name
  }, label)));
  sheetBody.replaceChildren(...tabs.map(([name]) => h("div", {
    role: "tabpanel", id: `charPanel-${name}`, "aria-labelledby": `charTab-${name}`, "data-tab": name, class: `g-sheet__panel g-sheet__panel--${name}`
  }, TAB_BUILDERS[name](member))));
  selectTab("character");

  if (member.slug) history.replaceState(null, "", `#char-${encodeURIComponent(member.slug)}`);
  window.clearTimeout(closeTimer);
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => dialogPanel.classList.add("is-visible"));
  $("#closeChar").focus();
}

function closeCharacter() {
  if (!dialog.open) return;
  dialogPanel.classList.remove("is-visible");
  if (window.location.hash.startsWith("#char-")) history.replaceState(null, "", window.location.pathname + window.location.search);
  closeTimer = window.setTimeout(() => {
    dialog.close();
    dialogTrigger?.focus();
  }, reducedMotion ? 0 : 420);
}

$("#closeChar").addEventListener("click", closeCharacter);
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeCharacter();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeCharacter();
});

function openFromHash() {
  const match = window.location.hash.match(/^#char-(.+)$/);
  if (!match) return;
  const slug = decodeURIComponent(match[1]);
  const member = state.members.find((m) => m.slug === slug);
  const card = [...document.querySelectorAll(".g-card__trigger")].find((node) => node.dataset.slug === slug);
  if (member) openCharacter(member, card || null);
}

// ---------- Boot ----------

async function boot() {
  try {
    const [guild, notes, roster] = await Promise.all([
      loadJson(`./${PAGE.data}`).then(validateGuild),
      loadJson(`./${PAGE.notes}`, { optional: true }),
      PAGE.portraits ? loadJson(`./${PAGE.portraits}`, { optional: true }) : null
    ]);
    state.notes = notes && typeof notes === "object" ? notes : { ranks: {} };
    state.portraits = readPortraits(roster);
    state.members = guild.members;
    state.guildName = guild.guild.name;
    state.catalog = guild.catalog && typeof guild.catalog === "object" ? guild.catalog : {};
    state.crafters = crafterIndex();

    renderHero(guild);
    renderMotd(state.notes, guild);
    renderChips();
    renderGrid();
    renderLadder();
    renderClasses();
    renderRoles();
    renderRaces();
    renderTotals(guild);
    renderRecords();
    renderLeaderboards();
    renderCrafting();
    renderDeeds(guild);
    openFromHash();
  } catch (error) {
    console.error(error);
    $("#rosterStatus").textContent = "Couldn't load the guild ledger. Try again in a bit.";
    $("#rosterNote").textContent = "OFFLINE";
  }

  $("#rosterSearch").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderGrid();
  });
  $("#rosterSort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    renderGrid();
  });
}

boot();
