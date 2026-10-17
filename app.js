// 🔗 Your published Google Sheet (TSV)
const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTDrnZp9JF0MARMOJRZYdAEjNj9gB5RnTNcYKIAwA2Grf41H5wQ9OQY7fNH7xE727mkvYkM4nhR56QZ/pub?gid=162465043&single=true&output=tsv";

// New fics get appended to the bottom of the sheet, so "new" = the last rows.
const NEW_ADDITIONS_COUNT = 8;
const RANDOM_PICKS_COUNT = 6;
const TAGS_SHOWN = 5;
const FEATURE_TAGS_SHOWN = 3;   // buddy reads stay compact

// This month's Dramione pick when no sheet row is flagged. It isn't in the library
// because the author asked for no epubs to be shared; we're reading it in the server.
// Flag a row in the sheet's "Dramione Buddy Read" column and that row wins instead.
const FALLBACK_DRAMIONE_PICK = {
  title: "Trials and Tribulations of Draco Malfoy's Employment",
  author: "LadyUrsa",
  noEpub: true,
  ao3Url: "https://archiveofourown.org/works/48861727/chapters/123263134",
};

// Fics we don't share at the authors' request (all-works entries have no `by`)
const NOT_SHARED = [
  { name: "AccioMjolnir", allWorks: true },
  { name: "After the Sea", by: "Colubrina" },
  { name: "BlueZeldana", allWorks: true },
  { name: "Chengbby", allWorks: true },
  { name: "EllieEckert", allWorks: true },
  { name: "Jelly_Roll", allWorks: true },
  { name: "Ladysophiac", allWorks: true },
  { name: "LadyUrsa", allWorks: true },
  { name: "Middle of the Night", by: "SereneMusafir" },
  { name: "Mirabella29", allWorks: true },
  { name: "Mon Couteau Aigue", by: "Gillianeliza" },
  { name: "Nothing Gold Can Stay", by: "SereneMusafir" },
  { name: "Ottersholdinghands", allWorks: true },
  { name: "RiddleMe_Nott (KLaColeReads)", allWorks: true },
  { name: "Shamione", allWorks: true },
  { name: "Sinflower81", allWorks: true },
];

// 📚 All fics from the sheet
let library = [];

// 🔗 Page elements
const $ = (id) => document.getElementById(id);
const resultsContainer = $("results");
const searchInput = $("searchInput");
const wordCountFilter = $("wordCountFilter");
const relationshipFilter = $("relationshipFilter");
const cortRecsFilter = $("cortRecsFilter");
const tropeFilter = $("tropeFilter");

// Tags to exclude from trope filter
const EXCLUDED_FROM_TROPES = new Set([
  'f/m', 'm/m', 'f/f', 'm/f',
  'no archive warnings apply',
  'choose not to use archive warnings',
  'explicit sexual content',
  'graphic depictions of violence',
  'major character death',
  'rape/non-con',
  'underage'
]);

// Character first names for filtering
const CHARACTER_FIRST_NAMES = new Set([
  'harry', 'hermione', 'draco', 'ron', 'ginny', 'luna', 'neville',
  'pansy', 'theo', 'blaise', 'daphne', 'astoria', 'lavender', 'parvati',
  'tom', 'voldemort', 'snape', 'severus', 'lucius', 'narcissa',
  'sirius', 'remus', 'james', 'lily', 'albus', 'dumbledore', 'minerva',
  'tonks', 'fleur', 'bill', 'charlie', 'fred', 'george', 'percy',
  'hagrid', 'dobby', 'kreacher', 'fenrir', 'bellatrix', 'regulus',
  'cedric', 'viktor', 'cho', 'dean', 'seamus', 'colin', 'dennis',
  'molly', 'arthur', 'andromeda', 'ted', 'horace', 'gilderoy',
  'quirinus', 'mad-eye', 'barty', 'myrtle', 'moaning',
  'peeves', 'argus', 'sybill', 'gellert', 'newt', 'credence',
  'nagini', 'queenie', 'tina', 'jacob', 'theseus', 'scorpius'
]);

const CHARACTER_LAST_NAMES = new Set([
  'potter', 'granger', 'weasley', 'malfoy', 'lovegood', 'longbottom',
  'parkinson', 'nott', 'zabini', 'greengrass', 'patil', 'brown',
  'riddle', 'snape', 'dumbledore', 'mcgonagall', 'black', 'lupin',
  'tonks', 'delacour', 'diggory', 'krum', 'chang', 'thomas', 'finnigan',
  'creevey', 'prewett', 'lestrange', 'crouch', 'moody', 'filch',
  'trelawney', 'slughorn', 'lockhart', 'quirrell', 'grindelwald',
  'scamander', 'goldstein', 'umbridge', 'fudge', 'shacklebolt',
  'vance', 'bones', 'abbott', 'macmillan', 'smith', 'corner',
  'boot', 'turpin', 'brocklehurst', 'carrow', 'yaxley', 'dolohov',
  'rookwood', 'avery', 'mulciber', 'rosier', 'wilkes', 'travers'
]);

// Check if a tag is JUST a character name (without descriptors)
function isPlainCharacterName(tag) {
  const words = tag.toLowerCase().trim().split(/\s+/);

  // Single word - check if it's a known first name
  if (words.length === 1) {
    return CHARACTER_FIRST_NAMES.has(words[0]);
  }

  // Two words - "FirstName LastName" or two first names like "Harry Ron"
  if (words.length === 2) {
    const [first, last] = words;
    if (CHARACTER_FIRST_NAMES.has(first) &&
        (CHARACTER_LAST_NAMES.has(last) || CHARACTER_FIRST_NAMES.has(last))) {
      return true;
    }
  }

  // Three words - "FirstName MiddleName LastName"
  if (words.length === 3) {
    const [first, middle, last] = words;
    if ((CHARACTER_FIRST_NAMES.has(first) || CHARACTER_FIRST_NAMES.has(middle)) &&
        CHARACTER_LAST_NAMES.has(last)) {
      return true;
    }
  }

  return false;
}

// 🧹 Helpers
function normalize(value) {
  return (value || "").toString().toLowerCase();
}

// Sheet text goes into innerHTML, so escape it first
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Only allow http(s) links from the sheet
function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : "";
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

function matchesQuery(item, query) {
  if (!query) return true;
  const q = normalize(query);

  return (
    normalize(item.title).includes(q) ||
    normalize(item.author).includes(q) ||
    normalize(item.mainRelationship).includes(q) ||
    normalize(item.summary).includes(q) ||
    normalize((item.tags || []).join(" ")).includes(q) ||
    normalize(item.cortsTiktokRecs).includes(q)
  );
}

function isCortRec(item) {
  const v = normalize(item.cortsTiktokRecs).trim();
  return v !== "" && v !== "false";
}

function matchesCortsFilter(item) {
  return !cortRecsFilter.checked || isCortRec(item);
}

function matchesWordCountFilter(item) {
  const filter = wordCountFilter.value;
  if (filter === "all") return true;

  // Word counts look like "123,456" or "123456"
  const wordCount = parseInt((item.words || "").replace(/,/g, ""), 10);
  if (isNaN(wordCount)) return false;

  if (filter === "under20k") return wordCount < 20000;
  if (filter === "20k-50k") return wordCount >= 20000 && wordCount < 50000;
  if (filter === "50k-100k") return wordCount >= 50000 && wordCount < 100000;
  if (filter === "100k-200k") return wordCount >= 100000 && wordCount < 200000;
  if (filter === "over200k") return wordCount >= 200000;

  return true;
}

// Pairing name -> test on a single lowercase pairing string (e.g. "hermione granger/draco malfoy")
const SHIPS = {
  dramione: (r) => r.includes("draco") && r.includes("hermione"),
  drarry: (r) => r.includes("draco") && r.includes("harry"),
  pansmione: (r) => r.includes("pansy") && r.includes("hermione"),
  theomione: (r) => r.includes("theo") && r.includes("hermione"),
  tomione: (r) => r.includes("tom") && r.includes("hermione"),
  pansville: (r) => r.includes("pansy") && r.includes("neville"),
  nottpott: (r) => r.includes("theo") && r.includes("harry"),
};

function matchesRelationshipFilter(item) {
  const filter = relationshipFilter.value;
  if (filter === "all") return true;

  // Split by comma to get individual pairings (e.g., "Hermione/Draco, Pansy/Harry")
  const pairings = (item.mainRelationship || "").split(",").map((r) => normalize(r.trim()));

  return pairings.some((rel) => {
    if (filter === "other") {
      return !Object.values(SHIPS).some((test) => test(rel));
    }
    return SHIPS[filter] ? SHIPS[filter](rel) : false;
  });
}

function matchesTropeFilter(item) {
  if (tropeFilter.value === "all") return true;
  const selected = tropeFilter.value.toLowerCase();
  return (item.tags || []).some((t) => normalize(t) === selected);
}

function matchesAllFilters(item) {
  return matchesCortsFilter(item) &&
    matchesWordCountFilter(item) &&
    matchesRelationshipFilter(item) &&
    matchesTropeFilter(item);
}

function hasActiveFilters() {
  return Boolean(
    searchInput.value.trim() ||
    wordCountFilter.value !== "all" ||
    relationshipFilter.value !== "all" ||
    tropeFilter.value !== "all" ||
    cortRecsFilter.checked
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Cover title sizing: one template, one type scale. The size steps down with title length
// to a hard floor; anything longer wraps, clamps and ends in an ellipsis rather than
// shrinking further. The full title always appears next to or below the cover.
const COVER_SIZES = [          // [max title length, font size (cqw), max lines]
  [24, 16, 4],
  [40, 14, 5],
  [Infinity, 12.5, 6],
];
const COVER_CHAR_WIDTH = 0.5;  // fallback glyph width (em) if the cover font hasn't loaded
const COVER_TEXT_WIDTH = 76;   // usable title width, in cqw

const graphemeSegmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("en", { granularity: "grapheme" })
  : null;
const glyphs = (str) => graphemeSegmenter
  ? Array.from(graphemeSegmenter.segment(str), (g) => g.segment)
  : Array.from(str);

// Width of a word in em, measured in the real cover font (conservative estimate until it loads)
const measureCtx = document.createElement("canvas").getContext("2d");
function wordEm(word) {
  const fontReady = measureCtx && document.fonts && document.fonts.check('700 16px "Cormorant Garamond"');
  if (!fontReady) return glyphs(word).length * COVER_CHAR_WIDTH;
  measureCtx.font = '700 100px "Cormorant Garamond", Georgia, serif';
  return measureCtx.measureText(word).width / 100;
}

function coverTitleFor(title) {
  const [, baseSize, lines] = COVER_SIZES.find(([max]) => title.length <= max);
  const floor = COVER_SIZES[COVER_SIZES.length - 1][1];

  // A long single word can't wrap: shrink to fit it, but never below the floor...
  const words = title.match(/[^\s-]+/g) || [title];
  const widest = Math.max(...words.map(wordEm));
  const size = Math.max(floor, Math.min(baseSize, COVER_TEXT_WIDTH / widest));

  // ...and if it still doesn't fit at the floor, cut it short with an ellipsis
  const fits = (w) => wordEm(w) * size <= COVER_TEXT_WIDTH;
  const text = title.replace(/[^\s-]+/g, (w) => {
    if (fits(w)) return w;
    const g = glyphs(w);
    let n = g.length - 1;
    while (n > 1 && !fits(g.slice(0, n).join("") + "…")) n--;
    return g.slice(0, n).join("") + "…";
  });

  return { text, size: size.toFixed(1), lines };
}

// Cover: the real image when the sheet has one, otherwise a generated jacket.
// The palette is derived from the title, so each fic always gets the same cover.
function coverHtml(item, linkUrl) {
  let h = 0;
  for (const ch of item.title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const { text, size, lines } = coverTitleFor(item.title);
  const cls = `cover cover-${h % 6}`;
  const style = `--len-size:${size}cqw;--len-lines:${lines}`;

  const art = safeUrl(item.cover);
  // If the image fails to load it removes itself and the generated cover shows through
  const img = art
    ? `<img class="cover-img" src="${esc(art)}" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  const inner = `<span class="cover-title">${esc(text)}</span><span class="cover-rule"></span><span class="cover-author">${esc(item.author || "")}</span>${img}`;

  return linkUrl
    ? `<a class="${cls}" style="${style}" href="${esc(linkUrl)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">${inner}</a>`
    : `<div class="${cls}" style="${style}" aria-hidden="true">${inner}</div>`;
}

function titleLink(item, link) {
  return link
    ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>`
    : esc(item.title);
}

function isCortBadged(item) {
  return normalize(item.cortsTiktokRecs).trim() === "true";
}

function badgeHtml(item) {
  return isCortBadged(item)
    ? `<div class="corts"><img src="images/cortrec-darkgreen-transparent-cropped.png" alt="Cort Rec" class="cort-badge"></div>`
    : "";
}

// Long tag lists are collapsed behind a "+N more" button
function tagsHtml(item, shown = TAGS_SHOWN) {
  const allTags = (item.tags || []).filter(Boolean);
  let html = allTags
    .map((t, i) => `<span class="tag${i >= shown ? " extra" : ""}">${esc(t)}</span>`)
    .join("");
  if (allTags.length > shown) {
    const more = allTags.length - shown;
    html += `<button class="tags-toggle" type="button" aria-expanded="false" data-more="${more}" aria-label="Show ${more} more tags">+${more} more</button>`;
  }
  return `<div class="tags">${html}</div>`;
}

function metaHtml(item) {
  return `
      <ul class="meta">
        ${item.mainRelationship ? `<li class="ship" title="${esc(item.mainRelationship)}">${esc(item.mainRelationship)}</li>` : ""}
        <li>${esc(item.words || "?")} words</li>
        <li>${esc(item.chapters || "?")} ${String(item.chapters).trim() === "1" ? "chapter" : "chapters"}</li>
      </ul>`;
}

function summaryHtml(item) {
  return item.summary
    ? `<p class="summary clamped">${esc(item.summary)}</p><button class="more-btn" type="button" aria-expanded="false" hidden>Read more</button>`
    : "";
}

// Library entry: cover + details (random picks, search results)
function renderFicCard(item) {
  const link = safeUrl(item.linkOnServer);
  return `
    <article class="fic${isCortBadged(item) ? " has-badge" : ""}">
      <div class="fic-cover">${coverHtml(item, link)}</div>
      <div class="fic-body">
        <h2>${titleLink(item, link)}</h2>
        <p class="fic-author">by ${esc(item.author || "Unknown")}</p>
        ${metaHtml(item)}
        ${summaryHtml(item)}
        ${tagsHtml(item)}
      </div>
      ${badgeHtml(item)}
    </article>
  `;
}

// Monthly buddy read: bigger cover, serif title
function renderFeaturedCard(item) {
  const link = safeUrl(item.linkOnServer || item.ao3Url);
  // A buddy read with both a summary and tags previews two lines of summary; "Read more" reveals the rest plus the tags
  const collapsible = !item.noEpub && item.summary && (item.tags || []).some(Boolean);
  const details = item.noEpub
    ? `<p class="feature-note">No epub for this one, at the author’s request. You can find it on <a href="${esc(safeUrl(item.ao3Url))}" target="_blank" rel="noopener noreferrer">AO3</a>.</p>`
    : `${metaHtml(item)}${summaryHtml(item)}${tagsHtml(item, FEATURE_TAGS_SHOWN)}`;
  return `
    <article class="feature${isCortBadged(item) ? " has-badge" : ""}${collapsible ? " collapsible" : ""}">
      ${coverHtml(item, link)}
      <div class="feature-body">
        <h3>${titleLink(item, link)}</h3>
        <p class="fic-author">by ${esc(item.author || "Unknown")}</p>
        ${details}
      </div>
      ${badgeHtml(item)}
    </article>
  `;
}

// "Just added" shelf: cover, title, author
function renderShelfItem(item) {
  const link = safeUrl(item.linkOnServer);
  return `
    <article class="shelf-item">
      ${coverHtml(item, link)}
      <h3>${titleLink(item, link)}</h3>
      <p>${esc(item.author || "Unknown")}</p>
    </article>
  `;
}

// Show "Read more" only on summaries that are actually cut off
function updateClampButtons(root = document) {
  root.querySelectorAll(".summary.clamped").forEach((p) => {
    const btn = p.nextElementSibling;
    if (btn && btn.classList.contains("more-btn")) {
      // Always offer the control on collapsible buddy reads: it's also the way to reach their tags
      btn.hidden = p.scrollHeight <= p.clientHeight + 1 && !p.closest(".feature.collapsible");
    }
  });
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".more-btn");
  if (!btn) return;
  const p = btn.previousElementSibling;
  const expanded = p.classList.toggle("clamped") === false;
  btn.textContent = expanded ? "Show less" : "Read more";
  btn.setAttribute("aria-expanded", String(expanded));
  const feature = btn.closest(".feature");
  if (feature) feature.classList.toggle("expanded", expanded);
});

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tags-toggle");
  if (!btn) return;
  const expanded = btn.parentElement.classList.toggle("expanded");
  btn.setAttribute("aria-expanded", String(expanded));
  btn.setAttribute("aria-label", expanded ? "Show fewer tags" : `Show ${btn.dataset.more} more tags`);
  btn.textContent = expanded ? "show fewer" : `+${btn.dataset.more} more`;
});

function setCards(container, items, emptyMessage, renderer = renderFicCard) {
  container.innerHTML = items.length
    ? items.map(renderer).join("")
    : `<p class="empty">${esc(emptyMessage)}</p>`;
  updateClampButtons(container);
}

function renderFeaturedLists() {
  let dramione = library.filter((i) => normalize(i.dramioneBuddyRead).trim() === "true");
  if (!dramione.length) dramione = [FALLBACK_DRAMIONE_PICK];
  const nonDramione = library.filter((i) => normalize(i.nonDramioneBuddyRead).trim() === "true");

  setCards($("dramioneList"), dramione, "Nothing picked yet. The suspense is part of the fun.", renderFeaturedCard);
  setCards($("nonDramioneList"), nonDramione, "Nothing picked yet. The suspense is part of the fun.", renderFeaturedCard);

  // A month with no pick collapses to one quiet line; with fewer than two picks the band goes single-column
  $("dramioneSection").classList.toggle("is-empty", !dramione.length);
  $("nonDramioneSection").classList.toggle("is-empty", !nonDramione.length);
  $("buddyReads").classList.toggle("solo", (dramione.length > 0) + (nonDramione.length > 0) < 2);
}

function renderNewAdditions() {
  const section = $("newSection");
  const newest = library.slice(-NEW_ADDITIONS_COUNT).reverse();
  if (!newest.length) return;
  setCards($("newList"), newest, "", renderShelfItem);
  section.hidden = false;
}

function setFeaturedVisible(visible) {
  $("newSection").hidden = !visible || !library.length;
  $("buddyReads").hidden = !visible;
  $("dramioneSection").hidden = !visible;
  $("nonDramioneSection").hidden = !visible;
}

function renderResults(items, { title, note = "", single = false } = {}) {
  $("resultsTitle").innerHTML = `${esc(title || "Results")}${note ? ` <small>${esc(note)}</small>` : ""}`;
  resultsContainer.classList.toggle("single", single);

  const countEl = $("resultsCount");

  if (!items.length) {
    resultsContainer.innerHTML = '<p class="empty">Nothing here. Loosen a filter or try a different trope. We know you have more than one.</p>';
    countEl.textContent = "";
    return;
  }

  resultsContainer.innerHTML = items.map(renderFicCard).join("");
  updateClampButtons(resultsContainer);
  countEl.textContent = "";
}

// Pick up to "count" random items (Fisher–Yates shuffle)
function getRandomItems(items, count) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

// Removable chips for each active filter
function renderChips() {
  const chips = [];
  const q = searchInput.value.trim();
  if (q) chips.push({ key: "search", label: `“${q}”` });
  if (wordCountFilter.value !== "all") {
    chips.push({ key: "words", label: wordCountFilter.selectedOptions[0].textContent });
  }
  if (relationshipFilter.value !== "all") {
    chips.push({ key: "ship", label: relationshipFilter.selectedOptions[0].textContent });
  }
  if (tropeFilter.value !== "all") {
    chips.push({ key: "tag", label: tropeFilter.selectedOptions[0].textContent.replace(/\s*\(\d+\)$/, "") });
  }
  if (cortRecsFilter.checked) chips.push({ key: "cort", label: "Cort recs" });

  $("activeFilters").innerHTML = chips.map((c) => `
    <span class="chip">${esc(c.label)}
      <button type="button" data-clear="${c.key}" aria-label="Remove filter ${esc(c.label)}">×</button>
    </span>`).join("");
}

$("activeFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-clear]");
  if (!btn) return;
  const key = btn.dataset.clear;
  if (key === "search") searchInput.value = "";
  if (key === "words") wordCountFilter.value = "all";
  if (key === "ship") relationshipFilter.value = "all";
  if (key === "tag") tropeFilter.value = "all";
  if (key === "cort") cortRecsFilter.checked = false;
  applyFilters();
});

// 🔎 Apply search + filters and show the right view
function applyFilters() {
  syncUrl();
  renderChips();

  if (!library.length) return;

  if (hasActiveFilters()) {
    setFeaturedVisible(false);
    const query = searchInput.value.trim();
    let filtered = library.filter(matchesAllFilters);
    if (query) filtered = filtered.filter((item) => matchesQuery(item, query));

    renderResults(filtered, { title: "Results" });
    if (filtered.length) {
      $("resultsCount").textContent = filtered.length === 1 ? "1 fic found" : `${filtered.length.toLocaleString()} fics found`;
    }
  } else {
    setFeaturedVisible(true);
    renderResults(getRandomItems(library, RANDOM_PICKS_COUNT), { title: "Random picks", note: "six fics, no questions asked" });
  }
}

// ---------------------------------------------------------------------------
// URL sync (shareable searches)
// ---------------------------------------------------------------------------

function syncUrl() {
  const params = new URLSearchParams();
  const q = searchInput.value.trim();
  if (q) params.set("q", q);
  if (wordCountFilter.value !== "all") params.set("words", wordCountFilter.value);
  if (relationshipFilter.value !== "all") params.set("ship", relationshipFilter.value);
  if (tropeFilter.value !== "all") params.set("tag", tropeFilter.value);
  if (cortRecsFilter.checked) params.set("cort", "1");

  const qs = params.toString();
  try {
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  } catch (e) { /* e.g. sandboxed file:// preview; not important */ }
}

function restoreFromUrl() {
  const params = new URLSearchParams(location.search);
  searchInput.value = params.get("q") || "";
  cortRecsFilter.checked = params.get("cort") === "1";

  const setSelect = (select, value) => {
    if (value && [...select.options].some((o) => o.value === value)) select.value = value;
  };
  setSelect(wordCountFilter, params.get("words"));
  setSelect(relationshipFilter, params.get("ship"));
  setSelect(tropeFilter, params.get("tag"));
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadSheetData() {
  const response = await fetch(SHEET_URL);
  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();

  // Google's published TSV is not quoted, so a plain split is correct here.
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((row) => row.split("\t"));

  const [headerRow, ...dataRows] = rows; // columns are read by position, except the optional cover column
  // Optional: a column headed "Cover" holding an image URL. Matched by name so it
  // never collides with the existing positional columns.
  const coverIdx = headerRow.findIndex((h) => /^cover(\s*(image|url|link))?$/i.test(h.trim()));

  library = dataRows
    .map((cols) => {
      const [
        title,
        linkOnServer,
        author,
        words,
        chapters,
        mainRelationship,
        summary,
        tags,
        cortsTiktokRecs,
        dramioneBuddyRead,
        nonDramioneBuddyRead,
      ] = cols;

      return {
        title: (title || "").trim(),
        linkOnServer: (linkOnServer || "").trim(),
        author: author || "",
        words: words || "",
        chapters: chapters || "",
        mainRelationship: mainRelationship || "",
        summary: summary || "",
        tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        cortsTiktokRecs: cortsTiktokRecs || "",
        dramioneBuddyRead: dramioneBuddyRead || "",
        nonDramioneBuddyRead: nonDramioneBuddyRead || "",
        cover: coverIdx >= 0 ? (cols[coverIdx] || "").trim() : "",
      };
    })
    .filter((item) => item.title);

  $("libraryCount").innerHTML =
    `<strong>${library.length.toLocaleString()}</strong> ${library.length === 1 ? "fic" : "fics"} and counting`;

  populateTropeFilter();
}

// 🏷️ Populate the trope filter dropdown with the top 15 tropes
function populateTropeFilter() {
  const tagCounts = {};

  library.forEach((item) => {
    item.tags.forEach((tag) => {
      // Skip archive warnings / relationship types, and plain character names
      // (but keep descriptive tags like "BAMF Hermione Granger")
      if (EXCLUDED_FROM_TROPES.has(normalize(tag))) return;
      if (isPlainCharacterName(tag)) return;
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([tag, count]) => {
      const option = document.createElement("option");
      option.value = tag.toLowerCase();
      option.textContent = `${tag} (${count})`;
      tropeFilter.appendChild(option);
    });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

// Typing must never lose focus on phones: apply after a short pause and
// put focus back if the re-render cost us the keyboard.
const applySearch = debounce(() => {
  const hadFocus = document.activeElement === searchInput;
  applyFilters();
  if (hadFocus && document.activeElement !== searchInput) {
    searchInput.focus({ preventScroll: true });
  }
}, 300);
searchInput.addEventListener("input", applySearch);
[wordCountFilter, relationshipFilter, tropeFilter, cortRecsFilter].forEach((el) => {
  el.addEventListener("change", applyFilters);
});

// 🎲 Random rec: one fic from whatever the filters allow
$("randomBtn").addEventListener("click", () => {
  if (!library.length) return;

  searchInput.value = "";
  renderChips();
  setFeaturedVisible(false);

  const pool = library.filter(matchesAllFilters);
  if (!pool.length) {
    renderResults([], { title: "Surprise" });
    return;
  }
  renderResults([pool[Math.floor(Math.random() * pool.length)]], { title: "Your random rec", note: "fate has spoken", single: true });
  resultsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ✕ Clear all filters
$("clearBtn").addEventListener("click", () => {
  searchInput.value = "";
  wordCountFilter.value = "all";
  relationshipFilter.value = "all";
  tropeFilter.value = "all";
  cortRecsFilter.checked = false;
  applyFilters();
});

window.addEventListener("resize", debounce(() => updateClampButtons(), 200));

async function initLibrary() {
  try {
    await loadSheetData();
  } catch (err) {
    console.error("Could not load the library sheet:", err);
    $("libraryCount").textContent = "";
    // Browsers block the sheet request when the page is opened straight from disk (file://)
    const msg = location.protocol === "file:"
      ? "Couldn’t load the library because the page was opened as a local file. Run <code>python3 -m http.server</code> in the site folder and open <code>http://localhost:8000</code> instead."
      : "Couldn’t load the library right now. Please refresh in a moment.";
    resultsContainer.innerHTML = `<p class="empty error-msg">${msg}</p>`;
    return;
  }

  restoreFromUrl();
  renderNewAdditions();
  renderFeaturedLists();
  applyFilters();
}

document.addEventListener("DOMContentLoaded", initLibrary);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const tabButtons = [...document.querySelectorAll(".tab-btn")];
const tabContents = document.querySelectorAll(".tab-content");

// Soft gate for the Typesets tab (not real protection; it's visible in the page source)
const TYPESETS_PASSWORD = "ChaosPuppy";
let isTypesetsUnlocked = localStorage.getItem("typesetsUnlocked") === "true";

function switchTab(targetTab) {
  if (targetTab === "typesets" && !isTypesetsUnlocked) {
    const password = prompt("Enter password to access Typesets:");
    if (password === TYPESETS_PASSWORD) {
      isTypesetsUnlocked = true;
      localStorage.setItem("typesetsUnlocked", "true");
    } else {
      alert("Incorrect password");
      return false;
    }
  }

  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === targetTab;
    btn.setAttribute("aria-selected", String(active));
    btn.tabIndex = active ? 0 : -1;
  });
  tabContents.forEach((content) => {
    content.classList.toggle("active", content.id === `${targetTab}-tab`);
  });

  localStorage.setItem("activeTab", targetTab);
  if (targetTab === "library") updateClampButtons();
  return true;
}

tabButtons.forEach((button, i) => {
  button.addEventListener("click", () => switchTab(button.dataset.tab));

  // Arrow-key navigation between tabs
  button.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = tabButtons[(i + (e.key === "ArrowRight" ? 1 : tabButtons.length - 1)) % tabButtons.length];
    if (switchTab(next.dataset.tab)) next.focus();
  });
});

// Restore the last-used tab (only if it's already unlocked, so we never prompt on load)
const savedTab = localStorage.getItem("activeTab");
if (savedTab === "typesets" && isTypesetsUnlocked) {
  switchTab("typesets");
}

// ---------------------------------------------------------------------------
// Typesets
// ---------------------------------------------------------------------------

const typesets = [
  'apostasy.Deydralinne.12sign.9pgs.ssbinding.pdf',
  'bloodysluttypathetic.whatmurdah.11sign.8pgs.SSBinding.pdf',
  'finding_hermione.Ebookdragon.23Sign.8Pgs.SSBinding.pdf',
  'hinkypunk.inkjinx.Quatro.5sign.2pgs.ssbinding.pdf',
  'keeper_of_the_moon.vol1.Stevie_Sunshine.16sign.7pgs.SSBinding.pdf',
  'love.and.other.historical.accidents.pacificrimbaud.11sign.10pgs.SSBinding.pdf',
  'no_one_will_miss_me.KittyBlush.6Signs.9Pages.SSBindingpdf.pdf',
  'ours_to_keep.Head_Over_Heels016.12Signs.7Pgs.SSBinding.pdf',
  'pretty_boy.Bremonster.6Signs.10PgsSSBinding.pdf',
  'remain_nameless.HeyJude19.18sign.9pgs.SSbinding.pdf',
  'secrets.and.masks.fullvolume.EmeraldSlytherin.40sign.8pgs.SSBinding.pdf',
  'the.rights.and.wrongs.series.tandem.LovesBitca8.22sign.10pgs.SSBinding.pdf',
  'the.rights.and.wrongs.series.tandem.vol.1.LovesBitca8.12sign.9pgs.SSBinding.pdf',
  'the.rights.and.wrongs.series.tandem.vol.2.LovesBitca.19sign.6pgs.SSBinding.pdf',
  'this.bitter.earth.ikorous.33Sign.8Page.SSbinding.pdf',
  'two.weddings.and.a.man.hunt.Deydralinne.Quatro.13sign.4pgs.SSBinding.pdf'
];

function parseTypesetFilename(filename) {
  const name = filename.replace('.pdf', '');
  const parts = name.split('.');

  let title = '';
  let author = '';
  let signatures = '';
  let pages = '';
  let binding = '';
  let bindingSize = '';

  // Find the "NNsign" part; the author is just before it (or before a binding size like "Quatro")
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.toLowerCase().includes('sign')) {
      signatures = part;
      if (i > 0) {
        const prevPart = parts[i - 1];
        if (['quatro', 'folio', 'octavo'].includes(prevPart.toLowerCase())) {
          bindingSize = prevPart;
          if (i > 1) {
            author = parts[i - 2]; // Keep underscores for author names
            title = parts.slice(0, i - 2).join(' ').replace(/_/g, ' ');
          }
        } else {
          author = prevPart;
          title = parts.slice(0, i - 1).join(' ').replace(/_/g, ' ');
        }
      }
      if (i + 1 < parts.length) {
        pages = parts[i + 1];
      }
      if (part.toLowerCase().includes('ssbinding') || (i + 2 < parts.length && parts[i + 2].toLowerCase().includes('ssbinding'))) {
        binding = 'Senna Slytherin binding';
      }
      break;
    }
  }

  const sigMatch = signatures.match(/(\d+)sign/i);
  const pgsMatch = pages.match(/(\d+)\s*(?:pgs|pages?)/i);

  title = title.split(' ').map((word) =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');

  if (bindingSize) {
    bindingSize = bindingSize.charAt(0).toUpperCase() + bindingSize.slice(1);
  }

  return {
    filename,
    title: title || 'Untitled',
    author: author || 'Unknown Author',
    signatures: sigMatch ? sigMatch[1] : '',
    pages: pgsMatch ? pgsMatch[1] : '',
    binding,
    bindingSize
  };
}

function renderTypesets() {
  const container = $('typesets-list');

  container.innerHTML = typesets.map((filename) => {
    const info = parseTypesetFilename(filename);

    const metaParts = [];
    if (info.bindingSize) metaParts.push(info.bindingSize);
    if (info.signatures) metaParts.push(`${info.signatures} signatures`);
    if (info.pages) metaParts.push(`${info.pages} pages per signature`);
    if (info.binding) metaParts.push(info.binding);

    return `
      <div class="typeset-item">
        <h3><a href="typesets/${encodeURIComponent(info.filename)}" target="_blank" rel="noopener noreferrer">${esc(info.title)}</a></h3>
        <p>by ${esc(info.author)}</p>
        <p>${esc(metaParts.join(' • '))}</p>
      </div>
    `;
  }).join('');
}

renderTypesets();

// ---------------------------------------------------------------------------
// Not shared (author requests)
// ---------------------------------------------------------------------------

$("notSharedList").innerHTML = NOT_SHARED.map((e) => `
  <li>${esc(e.name)}${e.by ? ` <span>by ${esc(e.by)}</span>` : ""}${e.allWorks ? ` <span>(all works)</span>` : ""}</li>
`).join("");
$("notSharedCount").textContent = `(${NOT_SHARED.length})`;
