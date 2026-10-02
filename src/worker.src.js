import { init as initJpeg, default as encodeJpeg } from '@jsquash/jpeg/encode.js';
import initOxipng, { optimise } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import initQuant, { quantize_image } from '@panda-ai/imagequant';
import { encodeIndexedPng } from './png-indexed.js';

const JPEG_QUALITY = 80;
const WEBP_QUALITY = 0.8;

// ---------- wasm loading ----------

const wasmBase = new URL('../wasm/', import.meta.url);
const compiled = {};

function loadWasm(name) {
  if (!compiled[name]) {
    compiled[name] = fetch(new URL(name, wasmBase))
      .then((res) => {
        if (!res.ok) throw new Error('Could not load ' + name);
        return res.arrayBuffer();
      })
      .then((buf) => WebAssembly.compile(buf));
  }
  return compiled[name];
}

let jpegReady, oxipngReady, quantReady;

function readyJpeg() {
  return (jpegReady ??= loadWasm('mozjpeg_enc.wasm').then((m) => initJpeg(m)));
}
function readyOxipng() {
  return (oxipngReady ??= loadWasm('squoosh_oxipng_bg.wasm').then((m) => initOxipng(m)));
}
function readyQuant() {
  return (quantReady ??= loadWasm('imagequant_bg.wasm').then((m) => initQuant({ module_or_path: m })));
}

// ---------- file type detection ----------

const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));

function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return 'png';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (ascii(b, 4, 8) === 'ftyp') {
    const brands = ascii(b, 8, Math.min(b.length, 64));
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (/hei|hev|mif1|msf1/.test(brands)) return 'heic';
  }
  return null;
}

function isAnimated(b, kind) {
  if (kind === 'gif') {
    let frames = 0;
    for (let i = 0; i < b.length - 3; i++) {
      if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) frames++;
      if (frames > 1) return true;
    }
  }
  if (kind === 'png') return ascii(b, 0, Math.min(b.length, 256)).includes('acTL');
  if (kind === 'webp') return ascii(b, 0, Math.min(b.length, 128)).includes('ANIM');
  return false;
}

const MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
};

// ---------- decoding and resizing ----------

let heicLib;

async function decodeHeic(bytes) {
  if (!heicLib) {
    const { default: factory } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
    let lib = factory();
    if (lib && typeof lib.then === 'function') lib = await lib;
    heicLib = lib;
  }
  const decoder = new heicLib.HeifDecoder();
  const images = decoder.decode(bytes);
  if (!images || !images.length) throw new Error('Could not read this HEIC file.');
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  const out = new ImageData(width, height);
  await new Promise((resolve, reject) => {
    image.display({ data: out.data, width, height }, (result) =>
      result ? resolve() : reject(new Error('Could not read this HEIC file.'))
    );
  });
  return createImageBitmap(out);
}

async function decode(bytes, kind) {
  try {
    return await createImageBitmap(new Blob([bytes], { type: MIME[kind] }));
  } catch (err) {
    if (kind === 'heic') return decodeHeic(bytes);
    throw err;
  }
}

function scaleTo(bitmap, targetW, targetH) {
  let src = bitmap;
  let sw = bitmap.width;
  let sh = bitmap.height;
  // Halve repeatedly so large reductions stay sharp.
  while (sw / 2 >= targetW) {
    const nw = Math.round(sw / 2);
    const nh = Math.round(sh / 2);
    const step = new OffscreenCanvas(nw, nh);
    const sctx = step.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, 0, 0, nw, nh);
    src = step;
    sw = nw;
    sh = nh;
  }
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, targetW, targetH);
  return { canvas, imageData: ctx.getImageData(0, 0, targetW, targetH) };
}

function hasAlpha(data) {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

// ---------- encoding ----------

async function encodePng(imageData) {
  await Promise.all([readyQuant(), readyOxipng()]);
  const { width, height, data } = imageData;
  const q = quantize_image(new Uint8Array(data.buffer, data.byteOffset, data.length), width, height, 256);
  const png = await encodeIndexedPng({ width, height, palette: q.palette, indices: q.indices });
  const optimised = optimise(png, 2, false, true);
  return optimised.length < png.length ? optimised : png;
}

async function encodeJpg(imageData) {
  await readyJpeg();
  return new Uint8Array(await encodeJpeg(imageData, { quality: JPEG_QUALITY }));
}

async function encodeWebp(canvas) {
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
  return blob.type === 'image/webp' ? new Uint8Array(await blob.arrayBuffer()) : null;
}

// ---------- job ----------

async function compress({ buffer, maxWidth }) {
  const bytes = new Uint8Array(buffer);
  const kind = sniff(bytes);
  if (!kind) throw new Error('This file is not a supported image.');
  if (isAnimated(bytes, kind)) throw new Error('Animated images are not supported.');

  let bitmap;
  try {
    bitmap = await decode(bytes, kind);
  } catch (err) {
    throw new Error(err && err.message && kind === 'heic' ? err.message : 'This image could not be opened.');
  }

  const origWidth = bitmap.width;
  const origHeight = bitmap.height;
  const width = Math.min(origWidth, maxWidth);
  const height = Math.max(1, Math.round((origHeight * width) / origWidth));
  const resized = width !== origWidth;

  let scaled;
  try {
    scaled = scaleTo(bitmap, width, height);
  } finally {
    bitmap.close();
  }
  const { canvas, imageData } = scaled;

  const alpha = hasAlpha(imageData.data);
  let outKind;
  let out = null;

  if (kind === 'webp') {
    out = await encodeWebp(canvas);
    outKind = 'webp';
  }
  if (!out) {
    outKind = kind === 'jpeg' ? 'jpeg' : kind === 'png' || kind === 'gif' || alpha ? 'png' : 'jpeg';
    out = outKind === 'png' ? await encodePng(imageData) : await encodeJpg(imageData);
  }

  let note = resized ? 'resized' : '';
  if (outKind !== kind) note = 'converted';

  if (!resized && outKind === kind && out.length >= bytes.length) {
    out = bytes;
    note = 'kept';
  }

  return {
    buffer: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength),
    kind: outKind,
    mime: MIME[outKind],
    width,
    height,
    origWidth,
    origHeight,
    from: kind,
    note,
  };
}

self.onmessage = async (event) => {
  const { id } = event.data;
  try {
    const result = await compress(event.data);
    self.postMessage({ id, ok: true, ...result }, [result.buffer]);
  } catch (err) {
    const message = err && err.message ? err.message : 'Something went wrong with this image.';
    self.postMessage({ id, ok: false, error: message });
  }
};
