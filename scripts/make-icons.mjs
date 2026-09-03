// Generates the PWA icons. Written by hand rather than pulled from a package:
// it is a few dozen lines of zlib and CRC, and it keeps a build-only image
// library out of the dependency tree.
import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  // 10-12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter byte; 0 means "none".
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A target/raid marker: a ring with a filled centre on the app's accent blue.
 * Deliberately generic rather than anything resembling game artwork.
 *
 * `padding` leaves a safe margin so Android's maskable crop does not clip it.
 */
function drawIcon(size, { padding = 0 } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const usable = size * (1 - padding * 2);

  const bg = [47, 111, 237];
  const fg = [255, 255, 255];
  const ringOuter = usable * 0.34;
  const ringInner = usable * 0.25;
  const dot = usable * 0.13;
  const corner = size * 0.22;

  // Anti-aliasing by supersampling: cheap at these sizes and avoids jaggies.
  const S = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      let ink = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          // Rounded square background.
          const qx = Math.max(Math.abs(px - cx) - (size / 2 - corner), 0);
          const qy = Math.max(Math.abs(py - cy) - (size / 2 - corner), 0);
          if (Math.hypot(qx, qy) <= corner) inside++;

          const r = Math.hypot(px - cx, py - cy);
          if ((r <= ringOuter && r >= ringInner) || r <= dot) ink++;
        }
      }
      const total = S * S;
      const a = inside / total;
      const t = ink / total;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(bg[0] * (1 - t) + fg[0] * t);
      rgba[i + 1] = Math.round(bg[1] * (1 - t) + fg[1] * t);
      rgba[i + 2] = Math.round(bg[2] * (1 - t) + fg[2] * t);
      rgba[i + 3] = Math.round(255 * a);
    }
  }
  return png(size, size, rgba);
}

await mkdir(OUT, { recursive: true });
const files = [
  ['icon-192.png', drawIcon(192)],
  ['icon-512.png', drawIcon(512)],
  // iOS ignores transparency and the manifest's maskable hint, so this one is
  // drawn square with its own inset.
  ['apple-touch-icon.png', drawIcon(180, { padding: 0.04 })],
];
for (const [name, buf] of files) {
  await writeFile(resolve(OUT, name), buf);
  console.log(`wrote public/${name} (${(buf.length / 1024).toFixed(1)} KB)`);
}
