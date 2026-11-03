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
const eventDialog = document.querySelector("#eventDialog");
const closeEventDialogButton = document.querySelector("#closeEventDialog");
const dialogCategory = document.querySelector("#eventDialogCategory");
const dialogDate = document.querySelector("#eventDialogDate");
const dialogTitle = document.querySelector("#eventDialogTitle");
const dialogDescription = document.querySelector("#eventDialogDescription");
const dialogDetails = document.querySelector("#eventDialogDetails");
const dialogMeta = document.querySelector("#eventDialogMeta");
const dialogPanel = eventDialog?.querySelector(".event-dialog__panel");
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

    for (const optionalField of ["time", "location", "image"]) {
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

function openEventDialog(event, trigger) {
  if (!eventDialog || !dialogPanel) return;

  window.clearTimeout(dialogCloseTimer);
  dialogTrigger = trigger;
  dialogCategory.textContent = event.category;
  dialogDate.dateTime = event.date;
  dialogDate.textContent = eventDateFormatter.format(new Date(`${event.date}T00:00:00Z`));
  dialogTitle.textContent = event.title;
  dialogDescription.textContent = event.description;
  dialogDetails.textContent = event.details;
  dialogMeta.replaceChildren();
  appendEventMeta("When", event.time);
  appendEventMeta("Where", event.location);
  eventDialog.showModal();
  window.requestAnimationFrame(() => dialogPanel.classList.add("is-visible"));
  closeEventDialogButton?.focus();
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

  if (event.image) {
    const photo = document.createElement("img");
    photo.className = "story__photo";
    photo.src = event.image;
    photo.alt = "";
    image.append(photo);
  } else {
    const sun = document.createElement("span");
    sun.className = event.artwork === "recruit" ? "story__moon" : "story__sun";
    const silhouette = document.createElement("span");
    silhouette.className = "story__silhouette";
    image.append(sun, silhouette);
  }

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
  dialogPanel?.classList.remove("is-visible");
  dialogTrigger?.focus();
});
loadEvents();
