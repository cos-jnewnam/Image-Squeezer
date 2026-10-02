import { crc32 } from '../js/crc32.js';

async function deflate(data) {
  const stream = new CompressionStream('deflate');
  const result = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(data);
  await writer.close();
  return new Uint8Array(await result);
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// Writes an 8-bit indexed PNG. palette is RGBA, 4 bytes per entry. Oxipng recompresses the result afterwards.
export async function encodeIndexedPng({ width, height, palette, indices }) {
  let max = 0;
  for (let i = 0; i < indices.length; i++) if (indices[i] > max) max = indices[i];
  const count = max + 1;

  const plte = new Uint8Array(count * 3);
  const alpha = new Uint8Array(count);
  let lastAlpha = -1;
  for (let i = 0; i < count; i++) {
    plte[i * 3] = palette[i * 4];
    plte[i * 3 + 1] = palette[i * 4 + 1];
    plte[i * 3 + 2] = palette[i * 4 + 2];
    alpha[i] = palette[i * 4 + 3];
    if (alpha[i] !== 255) lastAlpha = i;
  }

  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 3; // indexed color

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', plte),
  ];
  if (lastAlpha >= 0) parts.push(chunk('tRNS', alpha.subarray(0, lastAlpha + 1)));
  parts.push(chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0)));

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
