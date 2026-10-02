# Image Squeezer

Compresses images in the browser. Nothing is uploaded anywhere. Works offline once it has loaded, and can be installed as an app from the browser menu.

## What it does

- Takes up to 5 images at a time (drop, click, or paste).
- Caps width at 2000 px by default. The width box on the page changes it. Smaller images are never enlarged.
- JPEG stays JPEG (mozjpeg, quality 80). PNG stays PNG (libimagequant to 256 colors, then oxipng). WebP stays WebP.
- HEIC, AVIF, BMP and GIF are converted. They become JPEG, or PNG if they have transparency or are GIFs.
- If a file cannot get smaller and does not need resizing, the original is returned unchanged.
- Each image downloads on its own, or all at once as a zip.
- Animated GIF, PNG and WebP files are rejected so the animation is not silently flattened.

## Put it on GitHub Pages

1. Push this repository to GitHub.
2. In the repository, open Settings, then Pages, and set the source to **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`, which installs dependencies, runs the build and publishes the result.
4. After a minute the site is live at `https://<your-account>.github.io/<repo-name>/`. Share that link.

All paths are relative, so it works from a subfolder URL like that without changes.

The build output (`js/worker.js`, `js/chunks/`, `wasm/`, `sw.js`) is not committed. It is generated during the workflow, so the repository holds only source.

## Changing it

Edit `js/app.js`, `css/style.css` or `index.html` directly. No build needed.

To change the compression code or the service worker, edit `src/worker.src.js` or `src/sw.src.js` and run the following.

```
npm install
npm run build
```

This rebuilds `js/worker.js` and the `js/chunks` folder, copies the wasm files into `wasm/`, and generates `sw.js`.

Node 20 or newer is required.

Settings you are most likely to change in `src/worker.src.js`
- `JPEG_QUALITY` (80)
- `WEBP_QUALITY` (0.8)
- The oxipng level in `encodePng` (2 is fast, 3 saves a little more and is about 4x slower)

In `js/app.js`
- `MAX_FILES` (5)
- `MAX_BYTES` (60 MB per file)

## Publishing an update

Push to `main`. The build hashes the precached files and writes that hash into `sw.js` as the cache version, so installed copies pick up a change as soon as one actually happens. There is nothing to bump by hand.

## Notes

- Very large photos need memory to decode. A 10 MB JPEG is fine on a desktop. Phones with little memory may fail on huge files and will show an error on that row.
- TIFF is not supported because browsers cannot decode it.
- The HEIC decoder is about 2 MB. It only downloads the first time someone drops a HEIC file that the browser cannot open itself.

## License

MIT. See [LICENSE](LICENSE).
