import { makeZip } from './zip.js';

const MAX_FILES = 5;
const MAX_BYTES = 60 * 1024 * 1024;
const POOL_SIZE = Math.max(1, Math.min(2, navigator.hardwareConcurrency || 2));
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };

const $ = (id) => document.getElementById(id);
const drop = $('drop');
const picker = $('picker');
const maxw = $('maxw');
const notice = $('notice');
const list = $('list');
const actions = $('actions');
const zipBtn = $('zip');
const clearBtn = $('clear');
const total = $('total');

const items = [];
const queue = [];
const usedNames = new Set();
let nextId = 1;

// ---------- settings ----------

try {
  const saved = Number(localStorage.getItem('maxWidth'));
  if (saved >= 100 && saved <= 10000) maxw.value = saved;
} catch {}

function readMaxWidth() {
  let v = Math.round(Number(maxw.value));
  if (!Number.isFinite(v) || v < 100) v = 100;
  if (v > 10000) v = 10000;
  maxw.value = v;
  try { localStorage.setItem('maxWidth', String(v)); } catch {}
  return v;
}

maxw.addEventListener('change', readMaxWidth);

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
    slot.worker.postMessage({ id: item.id, buffer, maxWidth: item.maxWidth }, [buffer]);
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
  if (r.note === 'resized') return `Resized from ${r.origWidth} px wide. ${dims}`;
  if (r.note === 'converted') return `Converted from ${r.from.toUpperCase()} to ${EXT[r.kind].toUpperCase()}. ${dims}`;
  if (r.note === 'kept') return `Already compressed, original kept. ${dims}`;
  return dims;
}

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
  for (const file of accepted) {
    const item = { id: nextId++, file, status: 'queued', maxWidth };
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

// ---------- offline support ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
