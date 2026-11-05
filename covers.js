// Epub Cover Tool: runs entirely in the browser. Nothing is uploaded.
// Matches cover images to EPUBs by name, then writes new EPUBs with the covers embedded.

const $ = (id) => document.getElementById(id);
const IMG_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
const NATIVE = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif" };
const STOP = new Set(["cover", "covers", "final", "ebook", "epub", "the", "a", "an", "by", "copy", "new", "v2", "v1"]);

let epubFiles = [];
let coverFiles = [];
let data = null;
const thumbUrls = new Map();

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const extOf = (name) => { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(i).toLowerCase(); };
const stemOf = (name) => { const i = name.lastIndexOf("."); return i < 0 ? name : name.slice(0, i); };
const unescapeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&");

// ---------- matching ----------

function key(v) {
  return String(v ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
const tokens = (v) => key(v).split(" ").filter((t) => t && !STOP.has(t));

// Same idea as Python's difflib.SequenceMatcher.ratio(): recursively take the longest common block
function matchingChars(a, b) {
  if (!a.length || !b.length) return 0;
  let best = 0, ai = 0, bi = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) { best = cur[j]; ai = i - best; bi = j - best; }
      }
    }
    prev = cur;
  }
  if (!best) return 0;
  return best + matchingChars(a.slice(0, ai), b.slice(0, bi)) + matchingChars(a.slice(ai + best), b.slice(bi + best));
}
const ratio = (a, b) => (a.length + b.length ? (2 * matchingChars(a, b)) / (a.length + b.length) : 0);

function score(coverStem, ep) {
  const c = key(coverStem);
  const cand = [key(ep.title), key(`${ep.title} ${ep.author}`), key(`${ep.author} ${ep.title}`), key(stemOf(ep.file))].filter(Boolean);
  const best = cand.length ? Math.max(...cand.map((x) => ratio(c, x))) : 0;
  const ct = new Set(tokens(coverStem)), tt = new Set(tokens(ep.title));
  const shared = [...ct].filter((t) => tt.has(t)).length;
  const coverInTitle = ct.size ? shared / ct.size : 0;
  const titleInCover = tt.size ? shared / tt.size : 0;
  return Math.max(best, (coverInTitle + titleInCover) / 2);
}

// ---------- reading EPUBs ----------

const parseXml = (text) => new DOMParser().parseFromString(text, "application/xml");

async function opfPath(zip) {
  const doc = parseXml(await zip.file("META-INF/container.xml").async("string"));
  return doc.getElementsByTagNameNS("*", "rootfile")[0].getAttribute("full-path");
}

async function readEpub(file) {
  const info = { file: file.name, title: "", author: "", has_cover: false, error: "" };
  try {
    const zip = await JSZip.loadAsync(file);
    const opf = await opfPath(zip);
    const text = await zip.file(opf).async("string");
    const doc = parseXml(text);
    const md = doc.getElementsByTagNameNS("*", "metadata")[0];
    const first = (tag) => (md.getElementsByTagNameNS("*", tag)[0]?.textContent || "").trim();
    info.title = first("title").replace(/\s*\([\d,]+ words\)\s*$/, "");
    info.author = [...md.getElementsByTagNameNS("*", "creator")].map((e) => (e.textContent || "").trim()).join(", ");
    info.has_cover = [...md.getElementsByTagNameNS("*", "meta")].some((e) => e.getAttribute("name") === "cover") ||
      [...doc.getElementsByTagNameNS("*", "item")].some((i) => (i.getAttribute("properties") || "").includes("cover-image"));
  } catch (e) {
    info.error = String(e.message || e).slice(0, 80);
  }
  return info;
}

async function scan() {
  const epubs = [];
  for (let i = 0; i < epubFiles.length; i++) {
    $("scanStatus").textContent = `Reading EPUB ${i + 1} of ${epubFiles.length}…`;
    epubs.push(await readEpub(epubFiles[i]));
  }
  const covers = coverFiles;
  const pairs = [];
  epubs.forEach((e, ei) => covers.forEach((c, ci) => pairs.push([score(stemOf(c.name), e), ei, ci])));
  pairs.sort((x, y) => y[0] - x[0]);
  const takenE = new Set(), takenC = new Set(), match = new Map();
  for (const [s, ei, ci] of pairs) {
    if (s < 0.55 || takenE.has(ei) || takenC.has(ci)) continue;
    takenE.add(ei); takenC.add(ci); match.set(ei, [ci, s]);
  }
  epubs.forEach((e, ei) => {
    const m = match.get(ei);
    e.cover = m ? String(m[0]) : "";
    e.score = m ? Math.round(m[1] * 100) / 100 : 0;
  });
  return { epubs, covers: covers.map((f, i) => ({ id: String(i), name: f.name })) };
}

// ---------- preparing the image ----------

async function prepareImage(file, shrink) {
  const ext = extOf(file.name);
  if (NATIVE[ext] && !shrink) {
    return { bytes: new Uint8Array(await file.arrayBuffer()), ext: ext === ".jpeg" ? ".jpg" : ext, mime: NATIVE[ext] };
  }
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (shrink && Math.max(width, height) > 1600) {
    const k = 1600 / Math.max(width, height);
    width = Math.round(width * k); height = Math.round(height * k);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  const keepPng = ext === ".png" || ext === ".gif";
  if (!keepPng) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height); }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const mime = keepPng ? "image/png" : "image/jpeg";
  const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.92));
  if (!blob) throw new Error("couldn't convert that image");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: keepPng ? ".png" : ".jpg", mime };
}

// ---------- embedding the cover ----------

const joinPath = (base, href) => {
  const out = [];
  for (const part of (base + href).split("/")) {
    if (part === "..") out.pop(); else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
};
const swapAll = (s, a, b) => s.split(a).join(b);
const extOfHref = (href) => { const i = href.lastIndexOf("."); return i > href.lastIndexOf("/") ? href.slice(i) : ""; };

async function embed(file, image, addPage) {
  const zin = await JSZip.loadAsync(file);
  const opf = await opfPath(zin);
  const base = opf.includes("/") ? opf.slice(0, opf.lastIndexOf("/") + 1) : "";
  let text = await zin.file(opf).async("string");
  const { ext, mime } = image;
  const version = (/<package[^>]*\sversion="([\d.]+)"/.exec(text) || [0, "2.0"])[1];

  // An existing cover image keeps its place (so any cover page still points at it)
  let oldHref = null, oldItem = null;
  const m = /<meta[^>]*name="cover"[^>]*content="([^"]+)"/.exec(text) || /<meta[^>]*content="([^"]+)"[^>]*name="cover"/.exec(text);
  for (const item of text.match(/<item\b[^>]*\/?>/g) || []) {
    const iid = /\bid="([^"]*)"/.exec(item);
    const href = /\bhref="([^"]*)"/.exec(item);
    if (href && item.includes("image/") && ((m && iid && iid[1] === m[1]) || item.includes("cover-image"))) {
      oldHref = unescapeXml(href[1]); oldItem = item;
    }
  }
  const renames = [];
  let coverHref, coverZipPath, oldZipPath = null;
  if (oldHref) {
    const oldExt = extOfHref(oldHref);
    const stem = oldHref.slice(0, oldHref.length - oldExt.length);
    coverHref = oldExt.toLowerCase() === ext ? oldHref : stem + ext;
    const newItem = oldItem.replace(/media-type="[^"]*"/, () => `media-type="${mime}"`).replace(`href="${oldHref}"`, () => `href="${coverHref}"`);
    text = text.replace(oldItem, () => newItem);
    oldZipPath = joinPath(base, oldHref);
    coverZipPath = joinPath(base, coverHref);
    if (coverHref !== oldHref) renames.push([oldHref.split("/").pop(), coverHref.split("/").pop()]);
  } else {
    coverHref = `cover_image${ext}`;
    coverZipPath = base + coverHref;
    const props = version.startsWith("3") ? ' properties="cover-image"' : "";
    text = text.replace("</manifest>", () => `  <item id="cover-image" href="${coverHref}" media-type="${mime}"${props}/>\n  </manifest>`);
    if (!(m || /name="cover"/.test(text))) {
      text = text.replace(/<\/metadata>/, () => '  <meta name="cover" content="cover-image"/>\n  </metadata>');
    } else {
      text = text.replace(/(<meta[^>]*name="cover"[^>]*content=")[^"]*(")/, "$1cover-image$2");
    }
  }

  const extra = {};
  if (addPage && !oldHref && !/id="cover-page"/.test(text)) {
    extra[base + "cover_page.xhtml"] =
      '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title>' +
      "<style>body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head>" +
      `<body><div><img src="${coverHref}" alt="Cover"/></div></body></html>`;
    text = text.replace("</manifest>", () => '  <item id="cover-page" href="cover_page.xhtml" media-type="application/xhtml+xml"/>\n  </manifest>');
    text = text.replace(/(<spine\b[^>]*>)/, "$1\n    <itemref idref=\"cover-page\"/>");
  }

  const zout = new JSZip();
  const opts = { createFolders: false };
  zout.file("mimetype", "application/epub+zip", { ...opts, compression: "STORE" });
  for (const [n, entry] of Object.entries(zin.files)) {
    if (entry.dir || n === "mimetype" || n.startsWith("/") || n.split("/").includes("..")) continue;
    if (n === opf) {
      zout.file(n, text, { ...opts, compression: "DEFLATE" });
    } else if (n === coverZipPath || n === oldZipPath) {
      continue;
    } else if (renames.length && /\.(xhtml|html|htm|css|ncx)$/i.test(n)) {
      let body = await entry.async("string");
      for (const [a, b] of renames) body = swapAll(body, a, b);
      zout.file(n, body, { ...opts, compression: "DEFLATE" });
    } else {
      zout.file(n, await entry.async("uint8array"), { ...opts, compression: "DEFLATE" });
    }
  }
  zout.file(coverZipPath, image.bytes, { ...opts, compression: "DEFLATE" });
  for (const [n, body] of Object.entries(extra)) zout.file(n, body, { ...opts, compression: "DEFLATE" });
  const bytes = await zout.generateAsync({ type: "uint8array" });
  // sanity check: it opens and has the image
  const check = await JSZip.loadAsync(bytes);
  if (!check.file(coverZipPath)) throw new Error("the cover didn't get saved into the book");
  return new Blob([bytes], { type: "application/epub+zip" });
}

// ---------- page ----------

function thumbUrl(id) {
  if (!thumbUrls.has(id)) thumbUrls.set(id, URL.createObjectURL(coverFiles[Number(id)]));
  return thumbUrls.get(id);
}

function coverOptions(selected) {
  return `<option value="">No cover</option>` + data.covers.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("");
}

function render() {
  const matched = data.epubs.filter((e) => e.cover).length;
  $("summary").textContent = `${data.epubs.length} EPUBs, ${data.covers.length} covers, ${matched} matched`;
  $("rows").innerHTML = data.epubs.map((e, i) => {
    const conf = e.cover ? (e.score >= 0.7 ? `<span class="ct-tag ok">good match</span>` : `<span class="ct-tag warn">check this one</span>`) : `<span class="ct-tag warn">no match</span>`;
    return `<div class="ct-row" data-i="${i}">
      <input type="checkbox" class="use" aria-label="Use for ${esc(e.title || e.file)}" ${e.cover && !e.error ? "checked" : ""} ${e.error ? "disabled" : ""}>
      <div class="thumbbox">${e.cover ? `<img class="thumb" alt="" src="${thumbUrl(e.cover)}">` : `<div class="ph">none</div>`}</div>
      <div><div class="ct-title">${esc(e.title || e.file)}${conf}${e.has_cover ? `<span class="ct-tag">has a cover now</span>` : ""}</div>
        <div class="ct-meta">${esc(e.author)} · ${esc(e.file)}${e.error ? ` · <span class="ct-err">${esc(e.error)}</span>` : ""}</div></div>
      <div class="pick"><label class="ct-meta" for="sel${i}">Cover</label><select id="sel${i}">${coverOptions(e.cover)}</select></div>
    </div>`;
  }).join("");
  document.querySelectorAll(".ct-row select").forEach((sel) => sel.onchange = () => {
    const row = sel.closest(".ct-row");
    row.querySelector(".thumbbox").innerHTML = sel.value ? `<img class="thumb" alt="" src="${thumbUrl(sel.value)}">` : `<div class="ph">none</div>`;
    row.querySelector(".use").checked = !!sel.value;
  });
  $("results").hidden = false;
}

function setFiles(kind, files) {
  const list = [...files];
  if (kind === "epub") epubFiles = list.filter((f) => extOf(f.name) === ".epub");
  else coverFiles = list.filter((f) => IMG_EXT.includes(extOf(f.name)) && !f.name.startsWith("."));
  thumbUrls.forEach((u) => URL.revokeObjectURL(u)); thumbUrls.clear();
  $("scanStatus").textContent = `${epubFiles.length} EPUBs and ${coverFiles.length} covers chosen.`;
}

// Dropped folders have to be walked entry by entry
async function filesFromDrop(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  const walk = async (entry) => {
    if (entry.isFile) { out.push(await new Promise((res, rej) => entry.file(res, rej))); return; }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

for (const [kind, drop, input, folder] of [["epub", "dropEpub", "epubFiles", "epubFolder"], ["cover", "dropCover", "coverFiles", "coverFolder"]]) {
  $(input).onchange = () => setFiles(kind, $(input).files);
  $(folder).onchange = () => setFiles(kind, $(folder).files);
  const box = $(drop);
  box.ondragover = (e) => { e.preventDefault(); box.classList.add("over"); };
  box.ondragleave = () => box.classList.remove("over");
  box.ondrop = async (e) => { e.preventDefault(); box.classList.remove("over"); setFiles(kind, await filesFromDrop(e.dataTransfer)); };
}

$("scan").onclick = async () => {
  $("done").hidden = true;
  if (!epubFiles.length) { $("scanStatus").innerHTML = `<span class="ct-err">Choose at least one EPUB first.</span>`; return; }
  if (!coverFiles.length) { $("scanStatus").innerHTML = `<span class="ct-err">Choose at least one cover image first.</span>`; return; }
  $("scan").disabled = true;
  try {
    data = await scan();
    $("scanStatus").textContent = "";
    render();
  } catch (e) {
    $("scanStatus").innerHTML = `<span class="ct-err">${esc(e.message)}</span>`;
  }
  $("scan").disabled = false;
};

$("all").onclick = () => document.querySelectorAll(".ct-row .use:not(:disabled)").forEach((c) => c.checked = true);
$("none").onclick = () => document.querySelectorAll(".ct-row .use").forEach((c) => c.checked = false);

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

$("go").onclick = async () => {
  const picks = [...document.querySelectorAll(".ct-row")].filter((r) => r.querySelector(".use").checked && r.querySelector("select").value)
    .map((r) => ({ file: epubFiles.find((f) => f.name === data.epubs[r.dataset.i].file), cover: coverFiles[Number(r.querySelector("select").value)] }));
  if (!picks.length) { $("goStatus").textContent = "Nothing selected."; return; }
  $("go").disabled = true;
  const done = [], failed = [];
  for (let i = 0; i < picks.length; i++) {
    $("goStatus").textContent = `Working on ${i + 1} of ${picks.length}…`;
    try {
      const image = await prepareImage(picks[i].cover, $("shrink").checked);
      done.push({ name: picks[i].file.name, blob: await embed(picks[i].file, image, $("coverPage").checked) });
    } catch (e) {
      failed.push({ name: picks[i].file.name, error: String(e.message || e).slice(0, 120) });
    }
  }
  if (done.length === 1) {
    download(done[0].blob, done[0].name);
  } else if (done.length) {
    $("goStatus").textContent = "Zipping them up…";
    const zip = new JSZip();
    // Compressed (not "STORE"): Mac's Archive Utility refuses some zips of uncompressed EPUBs
    done.forEach((d) => zip.file(d.name, d.blob, { compression: "DEFLATE", createFolders: false }));
    download(await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }), "EPUBs with covers.zip");
  }
  $("doneList").innerHTML = (done.length ? `<li class="ct-good">${done.length} of ${picks.length} done. ${done.length === 1 ? "Your EPUB" : "A zip of your EPUBs"} should be in your downloads.</li>` : "") +
    failed.map((f) => `<li class="ct-err">${esc(f.name)}: ${esc(f.error)}</li>`).join("");
  $("done").hidden = false; $("goStatus").textContent = ""; $("go").disabled = false;
};
