import { build } from 'esbuild';
import { rmSync, mkdirSync, copyFileSync } from 'node:fs';

rmSync('js/chunks', { recursive: true, force: true });
rmSync('js/worker.js', { force: true });

await build({
  entryPoints: ['src/worker.src.js'],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: 'js',
  entryNames: 'worker',
  chunkNames: 'chunks/[name]-[hash]',
  minify: true,
  target: 'es2022',
  platform: 'browser',
  logLevel: 'info',
});

mkdirSync('wasm', { recursive: true });
copyFileSync('node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm', 'wasm/mozjpeg_enc.wasm');
copyFileSync('node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm', 'wasm/squoosh_oxipng_bg.wasm');
copyFileSync('node_modules/@panda-ai/imagequant/imagequant_bg.wasm', 'wasm/imagequant_bg.wasm');
console.log('wasm copied');
