import { makeZip } from './zip.js';

const MAX_FILES = 5;
const MAX_BYTES = 60 * 1024 * 1024;
const POOL_SIZE = Math.max(1, Math.min(2, navigator.hardwareConcurrency || 2));
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };

const $ = (id) => document.getElementById(id);
const drop = $('drop');
const picker = $('picker');
const maxw = $('maxw');
const format = $('format');
const formatHint = $('format-hint');
const quality = $('quality');
const qualityValue = $('quality-value');
const qualityHint = $('quality-hint');
const target = $('target');
const targetHint = $('target-hint');
const notice = $('notice');
const list = $('list');
const actions = $('actions');
const zipBtn = $('zip');
const shareBtn = $('share');
const clearBtn = $('clear');
const installBtn = $('install');
const compareDlg = $('compare');
const compareFrame = $('compare-frame');
const compareBefore = $('compare-before');
const compareAfter = $('compare-after');
const compareRange = $('compare-range');
const compareInfo = $('compare-info');
const total = $('total');

const items = [];
const queue = [];
const usedNames = new Set();
let nextId = 1;

// ---------- settings ----------

try {
  const saved = Number(localStorage.getItem('maxWidth'));
  if (saved >= 100 && saved <= 10000) maxw.value = saved;
  const savedFormat = localStorage.getItem('format');
  if (savedFormat && [...format.options].some((o) => o.value === savedFormat)) format.value = savedFormat;
  const savedQuality = Number(localStorage.getItem('quality'));
  if (savedQuality >= 40 && savedQuality <= 95) quality.value = savedQuality;
  const savedTarget = Number(localStorage.getItem('target'));
  if (savedTarget >= 0 && savedTarget <= 20000) target.value = savedTarget;
} catch {}

const FORMAT_HINTS = {
  auto: 'Auto picks whichever format comes out smallest.',
  jpeg: 'Transparent areas are filled with white.',
  png: 'Lossless, so photos can come out larger than the original.',
  webp: 'Small files with transparency, supported by every current browser.',
};

function readFormat() {
  const v = format.value;
  formatHint.textContent = FORMAT_HINTS[v] || '';
  // PNG output is lossless, so neither the slider nor a size target can apply.
  const lossless = v === 'png';
  quality.disabled = lossless;
  quality.parentElement.classList.toggle('off', lossless);
  qualityHint.textContent = lossless
    ? 'Not used, because PNG is lossless.'
    : 'Lower means smaller files and more blur.';
  target.disabled = lossless;
  target.parentElement.classList.toggle('off', lossless);
  targetHint.textContent = lossless
    ? 'Not used, because PNG is lossless.'
    : 'KB. Leave at 0 to use the quality setting instead.';
  try { localStorage.setItem('format', v); } catch {}
  return v;
}

function readTarget() {
  let v = Math.round(Number(target.value));
  if (!Number.isFinite(v) || v < 0) v = 0;
  if (v > 20000) v = 20000;
  target.value = v;
  try { localStorage.setItem('target', String(v)); } catch {}
  return v * 1024;
}

function readQuality() {
  let v = Math.round(Number(quality.value));
  if (!Number.isFinite(v) || v < 40) v = 40;
  if (v > 95) v = 95;
  quality.value = v;
  qualityValue.textContent = v;
  try { localStorage.setItem('quality', String(v)); } catch {}
  return v;
}

function readMaxWidth() {
  let v = Math.round(Number(maxw.value));
  if (!Number.isFinite(v) || v < 100) v = 100;
  if (v > 10000) v = 10000;
  maxw.value = v;
  try { localStorage.setItem('maxWidth', String(v)); } catch {}
  return v;
}

maxw.addEventListener('change', readMaxWidth);
format.addEventListener('change', readFormat);
quality.addEventListener('input', readQuality);
target.addEventListener('change', readTarget);
readFormat();
readQuality();

// ---------- helpers ----------

function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

function say(text) {
  notice.textContent = text;
  notice.hidden = !text;
}

function outputName(original, kind) {
  const base = original.replace(/\.[^.]*$/, '') || 'image';
  const ext = EXT[kind] || 'jpg';
  let name = `${base}-compressed.${ext}`;
  let n = 2;
  while (usedNames.has(name)) name = `${base}-compressed-${n++}.${ext}`;
  usedNames.add(name);
  return name;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- workers ----------

const pool = [];

function makeWorker() {
  const slot = { worker: new Worker('js/worker.js', { type: 'module' }), item: null };
  slot.worker.onmessage = (e) => finish(slot, e.data);
  slot.worker.onerror = () => {
    const item = slot.item;
    slot.item = null;
    if (item) fail(item, 'The compressor could not start. Reload the page and try again.');
    slot.worker.terminate();
    pool.splice(pool.indexOf(slot), 1);
    pump();
  };
  pool.push(slot);
  return slot;
}

function pump() {
  while (queue.length) {
    let slot = pool.find((s) => !s.item);
    if (!slot && pool.length < POOL_SIZE) slot = makeWorker();
    if (!slot) return;
    const item = queue.shift();
    if (item.removed) continue;
    run(slot, item);
  }
}

async function run(slot, item) {
  slot.item = item;
  setStatus(item, 'working');
  try {
    const buffer = await item.file.arrayBuffer();
    slot.worker.postMessage(
      {
        id: item.id,
        buffer,
        maxWidth: item.maxWidth,
        format: item.format,
        quality: item.quality,
        target: item.target,
      },
      [buffer]
    );
  } catch {
    slot.item = null;
    fail(item, 'This file could not be read.');
    pump();
  }
}

function finish(slot, data) {
  const item = slot.item;
  slot.item = null;
  if (item && !item.removed && item.id === data.id) {
    if (data.ok) succeed(item, data);
    else fail(item, data.error);
  }
  pump();
}

// ---------- rows ----------

function addRow(item) {
  const li = document.createElement('li');
  li.className = 'row';

  const thumb = document.createElement('div');
  thumb.className = 'thumb';

  const name = document.createElement('p');
  name.className = 'name';
  name.textContent = item.file.name;
  name.title = item.file.name;

  const tools = document.createElement('div');
  tools.className = 'tools';

  const detail = document.createElement('div');
  detail.className = 'detail';

  li.append(thumb, name, tools, detail);
  list.appendChild(li);
  item.el = { li, thumb, tools, detail };
  render(item);
}

function removeBtn(item) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'row-btn';
  b.textContent = 'Remove';
  b.setAttribute('aria-label', 'Remove ' + item.file.name);
  b.addEventListener('click', () => removeItem(item));
  return b;
}

// Sharing files is only wired up on some platforms, so ask before offering it.
function canShareFiles(files) {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files });
}

async function shareFiles(files, title) {
  try {
    await navigator.share({ files, title });
  } catch (err) {
    if (err.name !== 'AbortError') say('Sharing failed: ' + err.message);
  }
}

function canCopyImages() {
  return typeof ClipboardItem === 'function' && !!navigator.clipboard?.write;
}

// Chrome only accepts PNG on the clipboard, so anything else is redrawn.
async function toPngBlob(blob) {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

async function copyImage(blob, name) {
  try {
    // Passing a promise keeps the write inside the user gesture while the PNG is made.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPngBlob(blob) })]);
    say(`Copied ${name} to the clipboard.`);
  } catch (err) {
    say('Copying failed: ' + err.message);
  }
}

function render(item) {
  const { thumb, tools, detail } = item.el;
  thumb.replaceChildren();
  tools.replaceChildren();
  detail.replaceChildren();

  if (item.status === 'queued' || item.status === 'working') {
    const sp = document.createElement('div');
    sp.className = 'spinner';
    thumb.appendChild(sp);
    const p = document.createElement('p');
    p.className = 'status';
    p.textContent = item.status === 'queued' ? 'Waiting' : 'Compressing';
    detail.appendChild(p);
    tools.appendChild(removeBtn(item));
    return;
  }

  if (item.status === 'error') {
    const p = document.createElement('p');
    p.className = 'status err';
    p.textContent = item.error;
    detail.appendChild(p);
    tools.appendChild(removeBtn(item));
    return;
  }

  const r = item.result;
  const img = document.createElement('img');
  img.alt = '';
  img.src = r.url;
  thumb.appendChild(img);

  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'row-btn dl';
  dl.textContent = 'Download';
  dl.setAttribute('aria-label', 'Download ' + r.name);
  dl.addEventListener('click', () => download(r.blob, r.name));
  tools.append(dl, removeBtn(item));

  const shareFile = new File([r.blob], r.name, { type: r.blob.type });
  if (canShareFiles([shareFile])) {
    const sh = document.createElement('button');
    sh.type = 'button';
    sh.className = 'row-btn';
    sh.textContent = 'Share';
    sh.setAttribute('aria-label', 'Share ' + r.name);
    sh.addEventListener('click', () => shareFiles([shareFile], r.name));
    tools.insertBefore(sh, tools.lastChild);
  }

  if (canCopyImages()) {
    const cp = document.createElement('button');
    cp.type = 'button';
    cp.className = 'row-btn';
    cp.textContent = 'Copy';
    cp.setAttribute('aria-label', 'Copy ' + r.name + ' to the clipboard');
    cp.addEventListener('click', () => copyImage(r.blob, r.name));
    tools.insertBefore(cp, tools.lastChild);
  }

  // HEIC originals cannot be shown in an img, so there is nothing to compare against.
  if (r.from !== 'heic') {
    const cmp = document.createElement('button');
    cmp.type = 'button';
    cmp.className = 'row-btn';
    cmp.textContent = 'Compare';
    cmp.setAttribute('aria-label', 'Compare original and compressed ' + item.file.name);
    cmp.addEventListener('click', () => openCompare(item));
    tools.insertBefore(cmp, tools.lastChild);
  }

  const bar = document.createElement('div');
  bar.className = 'bar';
  const fill = document.createElement('i');
  bar.appendChild(fill);
  const ratio = Math.min(1, r.blob.size / item.file.size);
  requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = (ratio * 100).toFixed(1) + '%'; }));

  const sizes = document.createElement('p');
  sizes.className = 'sizes';
  const was = document.createElement('span');
  was.textContent = `${fmtBytes(item.file.size)} to ${fmtBytes(r.blob.size)}`;
  sizes.appendChild(was);

  const pct = Math.round((1 - r.blob.size / item.file.size) * 100);
  if (pct > 0) {
    const s = document.createElement('span');
    s.className = 'saved';
    s.textContent = `${pct}% smaller`;
    sizes.appendChild(s);
  }

  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = describe(r);
  sizes.appendChild(tag);

  detail.append(bar, sizes);
}

function describe(r) {
  const dims = `${r.width} \u00d7 ${r.height} px`;
  if (r.note === 'target') return `Met the ${fmtBytes(r.target)} target. ${dims}`;
  if (r.note === 'target-missed') return `As small as it goes, still over ${fmtBytes(r.target)}. ${dims}`;
  if (r.note === 'resized') return `Resized from ${r.origWidth} px wide. ${dims}`;
  if (r.note === 'converted') return `Converted from ${r.from.toUpperCase()} to ${EXT[r.kind].toUpperCase()}. ${dims}`;
  if (r.note === 'kept') return `Already compressed, original kept. ${dims}`;
  return dims;
}

// ---------- compare ----------

// The original is shown straight from the source file, so nothing extra is kept in memory.
let compareUrl = null;

function openCompare(item) {
  const r = item.result;
  if (compareUrl) URL.revokeObjectURL(compareUrl);
  compareUrl = URL.createObjectURL(item.file);
  compareBefore.src = compareUrl;
  compareAfter.src = r.url;
  compareRange.value = 50;
  compareFrame.style.setProperty('--pos', '50%');
  // Match the frame to the image so the divider never drifts over empty space.
  compareFrame.style.aspectRatio = `${r.width} / ${r.height}`;
  compareFrame.style.maxWidth = `calc(65vh * ${r.width} / ${r.height})`;
  const dims = r.width === r.origWidth ? `${r.width} px wide` : `${r.origWidth} to ${r.width} px wide`;
  compareInfo.textContent = `${fmtBytes(item.file.size)} to ${fmtBytes(r.blob.size)}, ${dims}`;
  compareDlg.showModal();
}

compareRange.addEventListener('input', () => {
  compareFrame.style.setProperty('--pos', compareRange.value + '%');
});

$('compare-close').addEventListener('click', () => compareDlg.close());

compareDlg.addEventListener('click', (e) => {
  if (e.target === compareDlg) compareDlg.close();
});

compareDlg.addEventListener('close', () => {
  compareBefore.removeAttribute('src');
  compareAfter.removeAttribute('src');
  if (compareUrl) {
    URL.revokeObjectURL(compareUrl);
    compareUrl = null;
  }
});

function setStatus(item, status) {
  item.status = status;
  render(item);
  refresh();
}

function succeed(item, data) {
  const blob = new Blob([data.buffer], { type: data.mime });
  item.result = {
    blob,
    url: URL.createObjectURL(blob),
    name: outputName(item.file.name, data.kind),
    kind: data.kind,
    from: data.from,
    note: data.note,
    target: data.target,
    width: data.width,
    height: data.height,
    origWidth: data.origWidth,
  };
  setStatus(item, 'done');
}

function fail(item, message) {
  item.error = message;
  setStatus(item, 'error');
}

function removeItem(item) {
  item.removed = true;
  items.splice(items.indexOf(item), 1);
  if (item.result) {
    URL.revokeObjectURL(item.result.url);
    usedNames.delete(item.result.name);
  }
  item.el.li.remove();
  say('');
  refresh();
}

// ---------- adding files ----------

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const room = MAX_FILES - items.length;
  if (room <= 0) {
    say(`The limit is ${MAX_FILES} images at a time. Remove one or clear the list first.`);
    return;
  }
  const accepted = files.slice(0, room);
  const skipped = files.length - accepted.length;
  say(skipped ? `The limit is ${MAX_FILES} images at a time. ${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped.` : '');

  const maxWidth = readMaxWidth();
  const outFormat = readFormat();
  const outQuality = readQuality();
  const outTarget = readTarget();
  for (const file of accepted) {
    const item = {
      id: nextId++,
      file,
      status: 'queued',
      maxWidth,
      format: outFormat,
      quality: outQuality,
      target: outTarget,
    };
    items.push(item);
    addRow(item);
    if (file.size > MAX_BYTES) {
      fail(item, `This file is over ${MAX_BYTES / 1024 / 1024} MB, which is too large to process here.`);
    } else {
      queue.push(item);
    }
  }
  refresh();
  pump();
}

// ---------- summary and bulk actions ----------

function refresh() {
  actions.hidden = items.length === 0;
  const done = items.filter((i) => i.status === 'done');
  const busy = items.some((i) => i.status === 'queued' || i.status === 'working');
  zipBtn.disabled = busy || done.length === 0;

  const files = done.map((i) => new File([i.result.blob], i.result.name, { type: i.result.blob.type }));
  shareBtn.hidden = !files.length || !canShareFiles(files);
  shareBtn.disabled = busy;

  if (done.length) {
    const before = done.reduce((n, i) => n + i.file.size, 0);
    const after = done.reduce((n, i) => n + i.result.blob.size, 0);
    const pct = Math.max(0, Math.round((1 - after / before) * 100));
    total.textContent = `${fmtBytes(before)} to ${fmtBytes(after)} (${pct}% smaller)`;
  } else {
    total.textContent = '';
  }
}

zipBtn.addEventListener('click', async () => {
  const done = items.filter((i) => i.status === 'done');
  if (!done.length) return;
  zipBtn.disabled = true;
  try {
    const files = [];
    for (const i of done) files.push({ name: i.result.name, data: new Uint8Array(await i.result.blob.arrayBuffer()) });
    download(makeZip(files), 'compressed-images.zip');
  } finally {
    refresh();
  }
});

shareBtn.addEventListener('click', async () => {
  const done = items.filter((i) => i.status === 'done');
  if (!done.length) return;
  const files = done.map((i) => new File([i.result.blob], i.result.name, { type: i.result.blob.type }));
  if (!canShareFiles(files)) return;
  await shareFiles(files, done.length === 1 ? files[0].name : 'Compressed images');
});

clearBtn.addEventListener('click', () => {
  for (const item of items.splice(0)) {
    item.removed = true;
    if (item.result) URL.revokeObjectURL(item.result.url);
  }
  usedNames.clear();
  list.replaceChildren();
  say('');
  refresh();
});

// ---------- input: click, drop, paste ----------

drop.addEventListener('click', () => picker.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    picker.click();
  }
});
picker.addEventListener('change', () => {
  addFiles(picker.files);
  picker.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  drop.classList.add('over');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) drop.classList.remove('over');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('over');
  addFiles(e.dataTransfer && e.dataTransfer.files);
});
window.addEventListener('paste', (e) => {
  if (e.clipboardData && e.clipboardData.files.length) addFiles(e.clipboardData.files);
});

// ---------- shared files ----------

// Picks up anything the service worker parked for us after a share sheet POST.
async function collectShared() {
  const url = new URL(location.href);
  if (url.searchParams.get('shared') !== '1') return;
  url.searchParams.delete('shared');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('image-squeezer-shared');
    const keys = (await cache.keys()).sort((a, b) => a.url.localeCompare(b.url));
    const files = [];
    for (const key of keys) {
      const res = await cache.match(key);
      await cache.delete(key);
      if (!res) continue;
      const name = decodeURIComponent(res.headers.get('X-Shared-Name') || 'shared-image');
      files.push(new File([await res.blob()], name, { type: res.headers.get('Content-Type') || '' }));
    }
    if (files.length) addFiles(files);
  } catch {}
}

collectShared();

// ---------- opened from the operating system ----------

// Fires when the installed app is used to open image files directly.
if ('launchQueue' in window && 'LaunchParams' in window && 'files' in LaunchParams.prototype) {
  launchQueue.setConsumer(async (params) => {
    if (!params || !params.files || !params.files.length) return;
    const files = [];
    for (const handle of params.files) {
      try {
        files.push(await handle.getFile());
      } catch {}
    }
    if (files.length) addFiles(files);
  });
}

// ---------- offline support ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- install ----------

// Only browsers that fire this event can install from a button, so it stays hidden elsewhere.
let installPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installBtn.hidden = false;
});

installBtn.addEventListener('click', async () => {
  if (!installPrompt) return;
  installBtn.disabled = true;
  installPrompt.prompt();
  await installPrompt.userChoice;
  // The saved event cannot be reused, so the button goes away either way.
  installPrompt = null;
  installBtn.disabled = false;
  installBtn.hidden = true;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installBtn.hidden = true;
});
