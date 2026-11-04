const intro = document.querySelector("#intro");
const skipIntro = document.querySelector("#skipIntro");
const introVideo = document.querySelector(".intro__video");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let introTimer;

function dismissIntro() {
  if (!intro || intro.classList.contains("is-gone")) return;
  window.clearTimeout(introTimer);
  intro.classList.add("is-gone");
  introVideo?.pause();
  document.body.classList.remove("intro-active");
  window.setTimeout(() => intro.remove(), 1100);
}

if (intro) {
  if (introVideo && !reducedMotion) {
    introVideo.addEventListener("canplay", () => {
      introVideo.classList.add("is-ready");
      introVideo.play().catch(() => {
        introVideo.classList.remove("is-ready");
      });
    }, { once: true });
    introVideo.load();
  }
  introTimer = window.setTimeout(dismissIntro, reducedMotion ? 250 : 4300);
  skipIntro?.addEventListener("click", dismissIntro);
}

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    if (intro && !intro.classList.contains("is-gone")) {
      event.preventDefault();
      dismissIntro();
      window.setTimeout(() => target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" }), 300);
    }
  });
});

const eventGrid = document.querySelector("#eventGrid");
const eventsStatus = document.querySelector("#eventsStatus");
const crewGrid = document.querySelector("#crewGrid");
const crewCount = document.querySelector("#crewCount");
const rosterStatus = document.querySelector("#rosterStatus");
const eventDialog = document.querySelector("#eventDialog");
const closeEventDialogButton = document.querySelector("#closeEventDialog");
const dialogCategory = document.querySelector("#eventDialogCategory");
const dialogDate = document.querySelector("#eventDialogDate");
const dialogTitle = document.querySelector("#eventDialogTitle");
const dialogDescription = document.querySelector("#eventDialogDescription");
const dialogDetails = document.querySelector("#eventDialogDetails");
const dialogMeta = document.querySelector("#eventDialogMeta");
const dialogPortrait = document.querySelector("#eventDialogPortrait");
const dialogPortraitWrap = document.querySelector("#eventDialogPortraitWrap");
const dialogPortraitVideo = document.querySelector("#eventDialogPortraitVideo");
const dialogPanel = eventDialog?.querySelector(".event-dialog__panel");
const dialogLink = document.querySelector("#eventDialogLink");
const newsGrid = document.querySelector("#newsGrid");
const newsStatus = document.querySelector("#newsStatus");
const newsUpdated = document.querySelector("#newsUpdated");
// Bump when replacing a character video so browsers fetch the new file.
const MEDIA_VERSION = "2";
// Blizzard panel in "Overheard in Azeroth" stays off until WoW: Forever launches.
const SHOW_BLIZZARD = false;
let dialogTrigger;
let dialogCloseTimer;

const eventDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC"
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageFilename(name) {
  return name === name.trim() && /^[\w][\w .-]*\.(?:jpe?g|png|webp)$/i.test(name) && !name.includes("..");
}

function assetUrl(name) {
  return `assets/${encodeURIComponent(name)}`;
}

function validateEvents(value) {
  if (!Array.isArray(value)) {
    throw new Error("events.json must contain a list of events.");
  }

  const ids = new Set();
  return value.map((event, index) => {
    const requiredStrings = ["id", "title", "description", "details", "category", "date", "artwork"];
    if (!isRecord(event) || requiredStrings.some((key) => typeof event[key] !== "string" || !event[key].trim())) {
      throw new Error(`Event ${index + 1} is missing a required text field.`);
    }

    if (ids.has(event.id)) {
      throw new Error(`Duplicate event id "${event.id}".`);
    }
    ids.add(event.id);

    const date = new Date(`${event.date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== event.date) {
      throw new Error(`Event "${event.id}" has an invalid date. Use YYYY-MM-DD.`);
    }

    if (!["raid", "recruit", "other"].includes(event.artwork)) {
      throw new Error(`Event "${event.id}" has an unsupported artwork style.`);
    }

    if (typeof event.image !== "string" || !isImageFilename(event.image)) {
      throw new Error(`Event "${event.id}" needs an image filename in assets/ (.jpg, .png or .webp).`);
    }

    for (const optionalField of ["time", "location"]) {
      if (event[optionalField] !== undefined && typeof event[optionalField] !== "string") {
        throw new Error(`Event "${event.id}" has an invalid ${optionalField}.`);
      }
    }

    return event;
  });
}

function appendEventMeta(label, value) {
  if (!value || !dialogMeta) return;

  const item = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  item.append(term, detail);
  dialogMeta.append(item);
}

function showDetailsDialog(trigger) {
  if (!eventDialog || !dialogPanel) return;

  window.clearTimeout(dialogCloseTimer);
  dialogTrigger = trigger;
  eventDialog.showModal();
  window.requestAnimationFrame(() => dialogPanel.classList.add("is-visible"));
  closeEventDialogButton?.focus();
}

// Undo news-only dialog tweaks before showing an event or character.
function resetNewsExtras() {
  dialogPortraitWrap?.classList.remove("event-dialog__portrait-wrap--wide");
  if (!dialogLink) return;
  dialogLink.hidden = true;
  dialogLink.removeAttribute("href");
}

function openEventDialog(event, trigger) {
  resetNewsExtras();
  dialogPortraitVideo.pause();
  dialogPortraitVideo.removeAttribute("src");
  dialogPortraitVideo.classList.remove("is-playing");
  dialogPanel?.classList.remove("event-dialog__panel--character");
  dialogCategory.textContent = event.category;
  dialogDate.hidden = false;
  dialogDate.dateTime = event.date;
  dialogDate.textContent = eventDateFormatter.format(new Date(`${event.date}T00:00:00Z`));
  dialogTitle.textContent = event.title;
  dialogDescription.textContent = event.description;
  dialogDetails.hidden = false;
  dialogDetails.textContent = event.details;
  dialogMeta.hidden = false;
  dialogMeta.replaceChildren();
  dialogPortrait.classList.remove("is-fallback", "is-covered");
  dialogPortrait.onerror = () => {
    console.error(`Could not load the image for event "${event.id}".`);
    dialogPortraitWrap.hidden = true;
  };
  dialogPortrait.src = assetUrl(event.image);
  dialogPortrait.alt = "";
  dialogPortrait.hidden = false;
  dialogPortraitVideo.hidden = true;
  dialogPortraitWrap.hidden = false;
  dialogPortraitVideo.onerror = null;
  dialogPortraitVideo.onplaying = null;
  dialogPortraitVideo.onpause = null;
  appendEventMeta("When", event.time);
  appendEventMeta("Where", event.location);
  showDetailsDialog(trigger);
}

function closeEventDialog() {
  if (!eventDialog?.open || !dialogPanel) return;

  dialogPanel.classList.remove("is-visible");
  window.clearTimeout(dialogCloseTimer);
  dialogCloseTimer = window.setTimeout(() => {
    if (eventDialog.open) eventDialog.close();
  }, reducedMotion ? 0 : 420);
}

function createEventCard(event, index) {
  const card = document.createElement("button");
  card.className = `story ${index === 0 ? "story--large" : "story--small"}`;
  card.type = "button";
  card.setAttribute("aria-haspopup", "dialog");
  card.setAttribute("aria-controls", "eventDialog");
  card.setAttribute("aria-label", `${event.title}. ${eventDateFormatter.format(new Date(`${event.date}T00:00:00Z`))}. View details.`);
  card.addEventListener("click", () => openEventDialog(event, card));

  const image = document.createElement("span");
  image.className = `story__image story__image--${event.artwork}`;
  image.setAttribute("aria-hidden", "true");

  const photo = document.createElement("img");
  photo.className = "story__photo";
  photo.src = assetUrl(event.image);
  photo.alt = "";
  // If the image is missing, fall back to the drawn artwork style.
  photo.addEventListener("error", () => {
    console.error(`Could not load the image for event "${event.id}"; showing the ${event.artwork} artwork instead.`);
    const sun = document.createElement("span");
    sun.className = event.artwork === "recruit" ? "story__moon" : "story__sun";
    const silhouette = document.createElement("span");
    silhouette.className = "story__silhouette";
    photo.replaceWith(sun, silhouette);
  }, { once: true });
  image.append(photo);

  const stamp = document.createElement("span");
  stamp.className = "story__stamp";
  stamp.textContent = event.category;
  const arrow = document.createElement("span");
  arrow.className = "story__arrow";
  arrow.textContent = "↗";
  image.append(stamp, arrow);

  const caption = document.createElement("span");
  caption.className = "story__caption";
  const title = document.createElement("b");
  title.textContent = event.title;
  const description = document.createElement("i");
  description.textContent = event.description;
  const date = document.createElement("time");
  date.dateTime = event.date;
  date.textContent = eventDateFormatter.format(new Date(`${event.date}T00:00:00Z`));
  caption.append(title, description, date);
  card.append(image, caption);
  return card;
}

async function loadEvents() {
  if (!eventGrid || !eventsStatus) return;

  try {
    const response = await fetch("./events.json");
    if (!response.ok) {
      throw new Error(`Could not load events.json (HTTP ${response.status}).`);
    }

    const events = validateEvents(await response.json());
    const notice = eventGrid.querySelector(".dispatches__scribble");
    if (events.length === 0) {
      eventsStatus.textContent = "No dispatches yet. Check back after the next questionable decision.";
      return;
    }

    events.forEach((event, index) => eventGrid.insertBefore(createEventCard(event, index), notice));
    eventsStatus.hidden = true;
  } catch (error) {
    console.error("Unable to load guild events.", error);
    eventsStatus.textContent = "Dispatches couldn’t load. Check events.json and refresh.";
  }
}

function validateRoster(value) {
  if (!Array.isArray(value)) {
    throw new Error("roster.json must contain a list of characters.");
  }

  const names = new Set();
  return value.map((character, index) => {
    const requiredStrings = ["name", "class", "description", "image"];
    if (!isRecord(character) || requiredStrings.some((key) => typeof character[key] !== "string" || !character[key].trim())) {
      throw new Error(`Character ${index + 1} is missing a required text field.`);
    }

    if (names.has(character.name)) {
      throw new Error(`Duplicate character name "${character.name}".`);
    }
    names.add(character.name);

    if (!isImageFilename(character.image)) {
      throw new Error(`Character "${character.name}" has an invalid image filename.`);
    }

    if (character.video !== undefined && (typeof character.video !== "string" || character.video !== character.video.trim() || !/^[\w][\w .-]*\.(?:mp4|webm)$/i.test(character.video) || character.video.includes(".."))) {
      throw new Error(`Character "${character.name}" has an invalid video filename.`);
    }

    if (character.race !== undefined && (typeof character.race !== "string" || !character.race.trim())) {
      throw new Error(`Character "${character.name}" has an invalid race.`);
    }

    return character;
  });
}

function playCharacterVideo(video, characterName, onFailure) {
  video.classList.add("is-playing");
  video.play().then(() => {
    video.classList.add("is-playing");
  }).catch((error) => {
    if (error.name !== "AbortError") {
      console.warn(`Could not play ${characterName}'s character video; showing the portrait instead.`, error);
    }
    video.pause();
    video.classList.remove("is-playing");
    onFailure?.();
  });
}

function createCharacterCard(character) {
  const article = document.createElement("article");
  article.className = "member";
  const trigger = document.createElement("button");
  trigger.className = "member__trigger";
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-controls", "eventDialog");
  trigger.setAttribute("aria-label", `${character.name}, ${character.class}. View character details.`);
  trigger.addEventListener("click", () => openCharacterDialog(character, trigger));

  const art = document.createElement("div");
  art.className = "member__art";
  const image = document.createElement("img");
  image.src = `assets/${encodeURIComponent(character.image)}`;
  image.alt = `${character.name} — ${character.class}`;
  art.append(image);

  if (character.video) {
    art.classList.add("member__art--video");
    const video = document.createElement("video");
    video.className = "member__video";
    video.src = `assets/${encodeURIComponent(character.video)}?v=${MEDIA_VERSION}`;
    video.poster = `assets/${encodeURIComponent(character.image)}`;
    video.muted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = "metadata";
    video.addEventListener("error", () => {
      console.error(`Could not load ${character.name}'s character video; showing the portrait instead.`);
      video.pause();
      video.classList.remove("is-playing");
    });
    const play = () => playCharacterVideo(video, character.name);
    const pause = () => {
      video.pause();
      video.classList.remove("is-playing");
    };
    trigger.addEventListener("pointerenter", play);
    trigger.addEventListener("pointerleave", pause);
    trigger.addEventListener("focus", play);
    trigger.addEventListener("blur", pause);
    art.append(video);
  }

  const label = document.createElement("div");
  label.className = "member__label";

  const name = document.createElement("h3");
  name.textContent = character.name;
  const characterClass = document.createElement("span");
  characterClass.className = "member__class";
  characterClass.textContent = character.class;
  label.append(name, characterClass);
  art.append(label);
  trigger.append(art);
  article.append(trigger);
  return article;
}

function openCharacterDialog(character, trigger) {
  resetNewsExtras();
  dialogPanel?.classList.add("event-dialog__panel--character");
  dialogCategory.textContent = "Roster";
  dialogDate.hidden = true;
  dialogDate.removeAttribute("datetime");
  dialogDate.textContent = "";
  dialogTitle.textContent = character.name;
  dialogDescription.textContent = character.description;
  dialogDetails.hidden = true;
  dialogDetails.textContent = "";
  dialogMeta.hidden = false;
  dialogMeta.replaceChildren();
  appendEventMeta("Name", character.name);
  appendEventMeta("Class", character.class);
  appendEventMeta("Race", character.race);
  dialogPortraitVideo.pause();
  dialogPortraitVideo.removeAttribute("src");
  dialogPortraitVideo.classList.remove("is-playing");
  dialogPortrait.classList.remove("is-covered");
  dialogPortrait.onerror = null;
  dialogPortrait.src = assetUrl(character.image);
  dialogPortrait.alt = `${character.name} — ${character.class}`;
  dialogPortrait.hidden = true;
  dialogPortraitVideo.hidden = true;
  dialogPortraitVideo.loop = true;
  dialogPortraitVideo.muted = true;
  dialogPortraitVideo.playsInline = true;
  dialogPortraitVideo.poster = `assets/${encodeURIComponent(character.image)}`;
  dialogPortraitWrap.hidden = false;
  showDetailsDialog(trigger);
  if (character.video) {
    const videoSource = `assets/${encodeURIComponent(character.video)}?v=${MEDIA_VERSION}`;
    dialogPortraitVideo.src = videoSource;
    dialogPortraitVideo.hidden = false;
    dialogPortraitVideo.onerror = () => {
      if (dialogPortraitVideo.getAttribute("src") !== videoSource) return;
      console.error(`Could not load ${character.name}'s character video; showing the portrait instead.`);
      dialogPortraitVideo.pause();
      dialogPortraitVideo.classList.remove("is-playing");
      dialogPortraitVideo.hidden = true;
      dialogPortrait.hidden = false;
    };
    dialogPortraitVideo.onplaying = () => {
      if (dialogPortraitVideo.getAttribute("src") !== videoSource) return;
      dialogPortraitVideo.hidden = false;
      dialogPortrait.classList.add("is-covered");
      dialogPortraitVideo.classList.add("is-playing");
    };
    dialogPortraitVideo.onpause = () => {
      const wasPlaying = dialogPortraitVideo.classList.contains("is-playing");
      dialogPortraitVideo.classList.remove("is-playing");
      if (wasPlaying && eventDialog.open && dialogPortraitVideo.getAttribute("src") === videoSource) {
        dialogPortraitVideo.hidden = true;
        dialogPortrait.classList.remove("is-covered");
        dialogPortrait.hidden = false;
      }
    };
    dialogPortraitVideo.load();
    playCharacterVideo(dialogPortraitVideo, character.name, () => {
      if (!eventDialog.open || dialogPortraitVideo.getAttribute("src") !== videoSource) return;
      dialogPortraitVideo.hidden = true;
      dialogPortrait.hidden = false;
    });
  } else {
    dialogPortrait.hidden = false;
  }
}

async function loadRoster() {
  if (!crewGrid || !crewCount || !rosterStatus) return;

  try {
    const response = await fetch("./roster.json");
    if (!response.ok) {
      throw new Error(`Could not load roster.json (HTTP ${response.status}).`);
    }

    const characters = validateRoster(await response.json());
    if (characters.length === 0) {
      crewCount.textContent = "NO SUSPECTS";
      rosterStatus.textContent = "No characters listed yet.";
      return;
    }

    characters.forEach((character) => crewGrid.append(createCharacterCard(character)));
    crewCount.textContent = `${String(characters.length).padStart(2, "0")} BAD IDEAS`;
    rosterStatus.hidden = true;
  } catch (error) {
    console.error("Unable to load the guild roster.", error);
    crewCount.textContent = "ROSTER UNAVAILABLE";
    rosterStatus.textContent = "The roster couldn’t load. Check roster.json and refresh.";
  }
}

// --- Overheard in Azeroth: news.json is built by scripts/fetch-news.mjs (GitHub Action). ---

function isHttpsUrl(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseNewsDate(value) {
  const date = new Date(value);
  return typeof value === "string" && !Number.isNaN(date.getTime()) ? date : null;
}

function validateNews(value) {
  if (!isRecord(value) || !Array.isArray(value.news)) {
    throw new Error("news.json must contain a news list.");
  }

  const news = value.news.filter((item) => isRecord(item)
    && ["id", "title", "description", "category"].every((key) => typeof item[key] === "string" && item[key].trim())
    && isHttpsUrl(item.url));

  return {
    generatedAt: parseNewsDate(value.generatedAt),
    news,
    blizzard: isRecord(value.blizzard) ? value.blizzard : null
  };
}

function openNewsDialog(item, trigger) {
  resetNewsExtras();
  dialogPortraitVideo.pause();
  dialogPortraitVideo.removeAttribute("src");
  dialogPortraitVideo.classList.remove("is-playing");
  dialogPortraitVideo.hidden = true;
  dialogPortraitVideo.onerror = null;
  dialogPortraitVideo.onplaying = null;
  dialogPortraitVideo.onpause = null;
  dialogPanel?.classList.remove("event-dialog__panel--character");
  dialogCategory.textContent = `${item.source || "News"} · ${item.category}`;

  const date = parseNewsDate(item.date);
  dialogDate.hidden = !date;
  if (date) {
    dialogDate.dateTime = date.toISOString();
    dialogDate.textContent = eventDateFormatter.format(date);
  }

  dialogTitle.textContent = item.title;
  dialogDescription.textContent = item.description;
  const paragraphs = typeof item.details === "string" ? item.details.split("\n").filter(Boolean) : [];
  dialogDetails.hidden = paragraphs.length === 0;
  dialogDetails.replaceChildren(...paragraphs.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
  dialogMeta.replaceChildren();
  dialogMeta.hidden = true;

  dialogPortrait.classList.remove("is-covered");
  dialogPortrait.onerror = () => {
    dialogPortraitWrap.hidden = true;
  };
  if (isHttpsUrl(item.image)) {
    dialogPortrait.src = item.image;
    dialogPortrait.alt = "";
    dialogPortrait.hidden = false;
    dialogPortraitWrap.hidden = false;
  } else {
    dialogPortrait.removeAttribute("src");
    dialogPortraitWrap.hidden = true;
  }
  dialogPortraitWrap.classList.add("event-dialog__portrait-wrap--wide");

  if (dialogLink) {
    dialogLink.href = item.url;
    dialogLink.firstChild.textContent = `Read it on ${item.source || "the source"} `;
    dialogLink.hidden = false;
  }
  showDetailsDialog(trigger);
}

function createNewsCard(item, index) {
  const card = document.createElement("button");
  card.className = `story news-story ${index === 0 ? "news-story--lead" : ""}`;
  card.type = "button";
  card.setAttribute("aria-haspopup", "dialog");
  card.setAttribute("aria-controls", "eventDialog");
  const date = parseNewsDate(item.date);
  card.setAttribute("aria-label", `${item.title}${date ? `. ${eventDateFormatter.format(date)}` : ""}. View details.`);
  card.addEventListener("click", () => openNewsDialog(item, card));

  const image = document.createElement("span");
  image.className = "story__image story__image--other";
  image.setAttribute("aria-hidden", "true");
  if (isHttpsUrl(item.image)) {
    const photo = document.createElement("img");
    photo.className = "story__photo";
    photo.src = item.image;
    photo.alt = "";
    photo.loading = "lazy";
    photo.referrerPolicy = "no-referrer";
    photo.addEventListener("error", () => photo.remove(), { once: true });
    image.append(photo);
  }

  const stamp = document.createElement("span");
  stamp.className = "story__stamp";
  stamp.textContent = item.category;
  const arrow = document.createElement("span");
  arrow.className = "story__arrow";
  arrow.textContent = "↗";
  image.append(stamp, arrow);

  const caption = document.createElement("span");
  caption.className = "story__caption";
  const title = document.createElement("b");
  title.textContent = item.title;
  const description = document.createElement("i");
  description.textContent = item.description;
  caption.append(title, description);
  if (date) {
    const time = document.createElement("time");
    time.dateTime = date.toISOString();
    time.textContent = `${item.source || "News"} · ${eventDateFormatter.format(date)}`;
    caption.append(time);
  }
  card.append(image, caption);
  return card;
}

function createWireRow(label, value, note) {
  const row = document.createElement("li");
  const term = document.createElement("span");
  term.textContent = label;
  const detail = document.createElement("b");
  detail.textContent = value;
  row.append(term, detail);
  if (note) {
    const small = document.createElement("i");
    small.textContent = note;
    row.append(small);
  }
  return row;
}

// The Blizzard panel sits in the grid like the dispatches scribble: a note, not a card.
function createBlizzardWire(blizzard) {
  const rows = [];
  const guild = isRecord(blizzard.guild) ? blizzard.guild : null;
  const realm = isRecord(blizzard.realm) ? blizzard.realm : null;

  if (realm && typeof realm.name === "string") {
    const realmNote = [realm.type, realm.category].filter((part) => typeof part === "string").join(" · ");
    rows.push(createWireRow("Realm", realm.name, realmNote));
    if (typeof realm.status === "string") {
      const population = typeof realm.population === "string" ? `${realm.population} population` : "";
      rows.push(createWireRow("Status", realm.status, population));
    }
  }

  if (guild) {
    if (Number.isFinite(guild.members)) rows.push(createWireRow("Members", String(guild.members), guild.realm));
    if (Number.isFinite(guild.achievementPoints)) rows.push(createWireRow("Achievement pts", guild.achievementPoints.toLocaleString("en-GB")));
    (Array.isArray(guild.activity) ? guild.activity : []).slice(0, 5).forEach((entry) => {
      if (!isRecord(entry) || typeof entry.title !== "string") return;
      const date = parseNewsDate(entry.date);
      const note = [entry.who, date && eventDateFormatter.format(date)].filter(Boolean).join(" · ");
      rows.push(createWireRow(String(entry.type || "Activity"), entry.title, note));
    });
  }

  if (rows.length === 0) return null;

  const wire = document.createElement("aside");
  wire.className = "news-wire";
  wire.setAttribute("aria-label", "From the Blizzard API");
  const overline = document.createElement("span");
  overline.textContent = "STRAIGHT FROM";
  const heading = document.createElement("b");
  heading.textContent = guild?.name ? guild.name : "Blizzard";
  const list = document.createElement("ul");
  list.append(...rows);
  wire.append(overline, heading, list);
  if (!guild) {
    const pending = document.createElement("i");
    pending.className = "news-wire__pending";
    pending.textContent = "Guild not founded yet. Any minute now. Probably.";
    wire.append(pending);
  }
  return wire;
}

async function loadNews() {
  if (!newsGrid || !newsStatus) return;

  try {
    const response = await fetch("./news.json", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`Could not load news.json (HTTP ${response.status}).`);
    }

    const { generatedAt, news, blizzard } = validateNews(await response.json());
    if (generatedAt && newsUpdated) {
      newsUpdated.textContent = `UPDATED ${eventDateFormatter.format(generatedAt).toUpperCase()}`;
    }

    news.forEach((item, index) => newsGrid.append(createNewsCard(item, index)));
    const wire = SHOW_BLIZZARD && blizzard && createBlizzardWire(blizzard);
    if (wire) newsGrid.insertBefore(wire, newsGrid.children[1] || null);

    if (news.length === 0 && !wire) {
      newsStatus.textContent = "Nothing overheard yet. Azeroth is suspiciously quiet.";
      return;
    }
    newsStatus.hidden = true;
  } catch (error) {
    console.error("Unable to load news.", error);
    if (newsUpdated) newsUpdated.textContent = "LINES DOWN";
    newsStatus.textContent = "The gossip couldn’t load. Check news.json and refresh.";
  }
}

closeEventDialogButton?.addEventListener("click", closeEventDialog);
eventDialog?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeEventDialog();
  }
});
eventDialog?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeEventDialog();
});
eventDialog?.addEventListener("click", (event) => {
  if (event.target === eventDialog) closeEventDialog();
});
eventDialog?.addEventListener("close", () => {
  dialogPortraitVideo.pause();
  dialogPortraitVideo.hidden = true;
  dialogPanel?.classList.remove("is-visible");
  dialogTrigger?.focus();
});
loadEvents();
loadRoster();
loadNews();
