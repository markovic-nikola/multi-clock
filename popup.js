/* ──────────────────────────────────────
   State
   ────────────────────────────────────── */

let clocks = [];
let hour12 = true;
let activeDropdownIndex = -1;
let updateInterval = null;
let dragState = null;

const clockListEl = document.getElementById("clock-list");
const emptyStateEl = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const dropdown = document.getElementById("search-dropdown");
const formatToggle = document.getElementById("format-toggle");

/* ──────────────────────────────────────
   Storage
   ────────────────────────────────────── */

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ clocks: [], hour12: true }, (result) => {
      clocks = result.clocks;
      hour12 = result.hour12;
      resolve();
    });
  });
}

function saveClocks() {
  chrome.storage.sync.set({ clocks });
}

function saveHour12() {
  chrome.storage.sync.set({ hour12 });
}

/* ──────────────────────────────────────
   Formatter cache
   ────────────────────────────────────── */

const formatterCache = new Map();

function getFormatter(timezone, options) {
  const key = timezone + JSON.stringify(options);
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }));
  }
  return formatterCache.get(key);
}

/* ──────────────────────────────────────
   Time utilities
   ────────────────────────────────────── */

function formatTime(timezone, now) {
  return getFormatter(timezone, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  }).format(now);
}

function formatDate(timezone, now) {
  return getFormatter(timezone, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
}

function getTimezoneOffsetMinutes(timezone, now) {
  const parts = getFormatter(timezone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);

  const tzDate = new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const localParts = getFormatter(Intl.DateTimeFormat().resolvedOptions().timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const getL = (type) => parseInt(localParts.find((p) => p.type === type).value, 10);
  const localDate = new Date(getL("year"), getL("month") - 1, getL("day"), getL("hour"), getL("minute"));

  return Math.round((tzDate - localDate) / 60000);
}

function getOffsetFromLocal(timezone, now) {
  const diffMinutes = getTimezoneOffsetMinutes(timezone, now);

  if (diffMinutes === 0) {
    return { label: "Same time", direction: "same" };
  }

  const absDiff = Math.abs(diffMinutes);
  const hours = Math.floor(absDiff / 60);
  const minutes = absDiff % 60;

  let timePart = "";
  if (hours && minutes) {
    timePart = `${hours}h ${minutes}m`;
  } else if (hours) {
    timePart = `${hours}h`;
  } else {
    timePart = `${minutes}m`;
  }

  const direction = diffMinutes > 0 ? "ahead" : "behind";
  return { label: `${timePart} ${direction}`, direction };
}

function formatUTCOffset(timezone, now) {
  const utcParts = getFormatter("UTC", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const getU = (type) => parseInt(utcParts.find((p) => p.type === type).value, 10);
  const utcDate = new Date(getU("year"), getU("month") - 1, getU("day"), getU("hour") === 24 ? 0 : getU("hour"), getU("minute"));

  const tzParts = getFormatter(timezone, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const getT = (type) => parseInt(tzParts.find((p) => p.type === type).value, 10);
  const tzDate = new Date(getT("year"), getT("month") - 1, getT("day"), getT("hour") === 24 ? 0 : getT("hour"), getT("minute"));

  const diffMinutes = Math.round((tzDate - utcDate) / 60000);
  const sign = diffMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(diffMinutes);
  const h = Math.floor(absMinutes / 60);
  const m = absMinutes % 60;

  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, "0")}`;
}

/* ──────────────────────────────────────
   XSS prevention
   ────────────────────────────────────── */

function escapeHTML(str) {
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

/* ──────────────────────────────────────
   Card rendering
   ────────────────────────────────────── */

function createClockCard(clock, index) {
  const now = new Date();
  const time = formatTime(clock.timezone, now);
  const date = formatDate(clock.timezone, now);
  const offset = getOffsetFromLocal(clock.timezone, now);
  const utc = formatUTCOffset(clock.timezone, now);

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="card__header">
      <div>
        <div class="card__city">${escapeHTML(clock.city)}</div>
        <div class="card__country">${escapeHTML(clock.country)}</div>
      </div>
      <button class="card__remove" data-index="${index}" title="Remove">&times;</button>
    </div>
    <div class="card__time" data-role="time">${escapeHTML(time)}</div>
    <div class="card__footer">
      <span class="card__date" data-role="date">${escapeHTML(date)}</span>
      <span class="card__offset card__offset--${offset.direction}" data-role="offset" data-timezone="${escapeHTML(clock.timezone)}">${escapeHTML(utc)} · ${escapeHTML(offset.label)}</span>
    </div>
  `;

  card.querySelector(".card__remove").addEventListener("click", () => removeClock(index));
  return card;
}

function renderClockList() {
  if (dragState) return;
  clockListEl.innerHTML = "";
  clocks.forEach((clock, i) => clockListEl.appendChild(createClockCard(clock, i)));
  emptyStateEl.className = clocks.length ? "empty-state empty-state--hidden" : "empty-state";
}

/* ──────────────────────────────────────
   Live updates
   ────────────────────────────────────── */

function updateAllClocks() {
  const now = new Date();
  const cards = clockListEl.querySelectorAll(".card");

  cards.forEach((card, i) => {
    const clock = clocks[i];
    if (!clock) return;

    card.querySelector('[data-role="time"]').textContent = formatTime(clock.timezone, now);
    card.querySelector('[data-role="date"]').textContent = formatDate(clock.timezone, now);

    const offsetEl = card.querySelector('[data-role="offset"]');
    const offset = getOffsetFromLocal(clock.timezone, now);
    const utc = formatUTCOffset(clock.timezone, now);
    offsetEl.textContent = `${utc} · ${offset.label}`;
    offsetEl.className = `card__offset card__offset--${offset.direction}`;
  });
}

function startLiveUpdates() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(updateAllClocks, 1000);
}

/* ──────────────────────────────────────
   Drag and drop reordering
   ────────────────────────────────────── */

function initDragAndDrop() {
  clockListEl.addEventListener("pointerdown", onDragPointerDown);
}

function onDragPointerDown(e) {
  if (e.button !== 0) return;
  const card = e.target.closest(".card");
  if (!card || e.target.closest(".card__remove")) return;

  e.preventDefault();
  card.setPointerCapture(e.pointerId);

  const cards = Array.from(clockListEl.querySelectorAll(".card"));
  const startIndex = cards.indexOf(card);
  const cardHeight = cards.length > 1
    ? cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().top
    : 0;

  dragState = { card, startIndex, currentIndex: startIndex, startY: e.clientY, cardHeight, cards };

  card.classList.add("card--dragging");
  cards.forEach((c) => { if (c !== card) c.classList.add("card--shifting"); });

  card.addEventListener("pointermove", onDragPointerMove);
  card.addEventListener("pointerup", onDragPointerUp);
}

function onDragPointerMove(e) {
  if (!dragState) return;

  const { card, startIndex, cardHeight, cards } = dragState;
  const deltaY = e.clientY - dragState.startY;

  card.style.transform = `translateY(${deltaY}px)`;

  if (cardHeight === 0) return;

  const newIndex = Math.max(0, Math.min(cards.length - 1, startIndex + Math.round(deltaY / cardHeight)));

  if (newIndex !== dragState.currentIndex) {
    dragState.currentIndex = newIndex;
    cards.forEach((c, i) => {
      if (c === card) return;
      if (i >= Math.min(startIndex, newIndex) && i <= Math.max(startIndex, newIndex)) {
        c.style.transform = `translateY(${i < startIndex ? cardHeight : -cardHeight}px)`;
      } else {
        c.style.transform = "";
      }
    });
  }
}

function onDragPointerUp(e) {
  if (!dragState) return;

  const { card, startIndex, currentIndex, cards } = dragState;

  card.removeEventListener("pointermove", onDragPointerMove);
  card.removeEventListener("pointerup", onDragPointerUp);

  card.classList.remove("card--dragging");
  card.style.transform = "";
  cards.forEach((c) => {
    c.classList.remove("card--shifting");
    c.style.transform = "";
  });

  const indexChanged = startIndex !== currentIndex;
  dragState = null;

  if (indexChanged) {
    const [moved] = clocks.splice(startIndex, 1);
    clocks.splice(currentIndex, 0, moved);
    saveClocks();
    renderClockList();
  }
}

/* ──────────────────────────────────────
   Search
   ────────────────────────────────────── */

function searchTimezones(query) {
  if (!query.trim()) return [];
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const addedTimezones = new Set(clocks.map((c) => c.timezone + c.city));

  return TIMEZONE_DATA.filter((entry) => {
    if (addedTimezones.has(entry.timezone + entry.city)) return false;
    const fields = [entry.city, entry.country, entry.region, ...(entry.keywords || [])];
    const haystack = fields.map((f) => f.toLowerCase());
    return words.every((word) => haystack.some((field) => field.includes(word)));
  }).slice(0, 8);
}

function renderSearchResults(results) {
  dropdown.innerHTML = "";
  activeDropdownIndex = -1;

  if (results.length === 0 && searchInput.value.trim()) {
    dropdown.innerHTML = `<li class="search__no-results">No results found</li>`;
    dropdown.classList.add("search__dropdown--visible");
    return;
  }

  if (results.length === 0) {
    closeDropdown();
    return;
  }

  results.forEach((entry, i) => {
    const li = document.createElement("li");
    li.className = "search__result";
    li.dataset.index = i;
    li.innerHTML = `
      <div class="search__result-city">${escapeHTML(entry.city)}</div>
      <div class="search__result-detail">${escapeHTML(entry.country)} · ${escapeHTML(entry.region)}</div>
    `;
    li.addEventListener("click", () => {
      addClock(entry);
      searchInput.value = "";
      closeDropdown();
    });
    dropdown.appendChild(li);
  });

  dropdown.classList.add("search__dropdown--visible");
}

function closeDropdown() {
  dropdown.classList.remove("search__dropdown--visible");
  dropdown.innerHTML = "";
  activeDropdownIndex = -1;
}

function setActiveResult(index) {
  const items = dropdown.querySelectorAll(".search__result");
  items.forEach((item) => item.classList.remove("search__result--active"));
  activeDropdownIndex = index;
  if (index >= 0 && index < items.length) {
    items[index].classList.add("search__result--active");
    items[index].scrollIntoView({ block: "nearest" });
  }
}

/* ──────────────────────────────────────
   Add / Remove
   ────────────────────────────────────── */

function addClock(entry) {
  const exists = clocks.some((c) => c.timezone === entry.timezone && c.city === entry.city);
  if (exists) return;

  clocks.push({ city: entry.city, country: entry.country, timezone: entry.timezone });
  saveClocks();
  renderClockList();
}

function removeClock(index) {
  clocks.splice(index, 1);
  saveClocks();
  renderClockList();
}

/* ──────────────────────────────────────
   Event listeners
   ────────────────────────────────────── */

searchInput.addEventListener("input", () => {
  const results = searchTimezones(searchInput.value);
  renderSearchResults(results);
});

searchInput.addEventListener("keydown", (e) => {
  const items = dropdown.querySelectorAll(".search__result");
  if (!items.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    setActiveResult(activeDropdownIndex < items.length - 1 ? activeDropdownIndex + 1 : 0);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setActiveResult(activeDropdownIndex > 0 ? activeDropdownIndex - 1 : items.length - 1);
  } else if (e.key === "Enter" && activeDropdownIndex >= 0) {
    e.preventDefault();
    items[activeDropdownIndex].click();
  } else if (e.key === "Escape") {
    searchInput.value = "";
    closeDropdown();
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".search")) {
    closeDropdown();
  }
});

/* ──────────────────────────────────────
   Init
   ────────────────────────────────────── */

function updateFormatToggle() {
  formatToggle.textContent = hour12 ? "12h" : "24h";
}

formatToggle.addEventListener("click", () => {
  hour12 = !hour12;
  formatterCache.clear();
  updateFormatToggle();
  saveHour12();
  renderClockList();
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  updateFormatToggle();
  renderClockList();
  initDragAndDrop();
  startLiveUpdates();
  searchInput.focus();
});
