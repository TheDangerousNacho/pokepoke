// Stages the Tesseract runtime into public/tesseract/ so the app serves it
// from its own origin.
//
// Why not the CDN default: tesseract.js builds its worker from a blob URL and
// has that worker importScripts() the CDN, which is a cross-origin load from an
// opaque origin. It fails outright in some browsers — including on the
// deployed site — and even where it works it makes a tool meant for use at a
// raid gym depend on a third party being reachable. Same-origin assets also
// let the browser cache them, so the second scan of the day costs nothing.
//
// The files are gitignored and staged by CI before the build, so the repo does
// not carry ~9MB of binaries.
import { copyFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/tesseract');

// The "fast" English model. The full model is ~5x larger for accuracy we do not
// need: we read a handful of large glyphs, not scanned prose.
const LANG_URL = 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz';

/**
 * tesseract.js picks a core variant at runtime from what the browser supports,
 * so every variant it might ask for has to be present. The LSTM-only builds
 * are the smaller ones and are all the modern engine uses.
 */
const CORE_FILES = [
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

await mkdir(OUT, { recursive: true });

const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const workerSrc = resolve(dirname(require.resolve('tesseract.js/package.json')), 'dist/worker.min.js');

let total = 0;
const copied = [];
for (const src of [workerSrc, ...CORE_FILES.map((f) => resolve(coreDir, f))]) {
  const dest = resolve(OUT, basename(src));
  await copyFile(src, dest);
  const { size } = await stat(dest);
  total += size;
  copied.push(basename(src));
}

const langDest = resolve(OUT, 'eng.traineddata.gz');
let langSize = 0;
try {
  langSize = (await stat(langDest)).size;
  console.log('eng.traineddata.gz already present, skipping download');
} catch {
  console.log('downloading eng.traineddata.gz ...');
  const res = await fetch(LANG_URL);
  if (!res.ok) throw new Error(`language data fetch failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(langDest, buf);
  langSize = buf.length;
}
total += langSize;

console.log(`staged ${copied.length + 1} files in public/tesseract/ (${(total / 1048576).toFixed(1)} MB)`);
