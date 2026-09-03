/**
 * Image preparation for OCR.
 *
 * Pokémon GO renders CP as white text with a dark outline over a coloured
 * gradient — close to the worst case for default OCR, which expects dark text
 * on a light background. So rather than one pass over the raw screenshot, we
 * produce several deliberately different renderings and let the caller try
 * each until one yields a plausible reading.
 */

export interface Prepared {
  /** The whole screenshot, upscaled if small. Used for name, types and HP. */
  full: string;
  /**
   * Candidate CP regions, each with several renderings, ordered by how likely
   * the region is. The caller tries a whole band, and only moves to the next
   * if nothing it read holds up — so the common case still costs one band.
   */
  cpBands: string[][];
  /**
   * The lower half at higher resolution. The power-up cost and the candy
   * labels live here in small text that the full-page pass reads poorly, and
   * their vertical position shifts between layouts (a Dynamax row pushes
   * everything down), so this is a generous band rather than a tight crop.
   */
  detailBand: string;
  width: number;
  height: number;
}

/** Tesseract degrades sharply below roughly this width. */
const MIN_WIDTH = 1000;

/**
 * Where CP might sit on the detail screen.
 *
 * Cropped horizontally as well as vertically, which matters more than it
 * sounds: CP is centred, while the phone's status bar puts a clock on the left
 * and battery icons on the right. Reading the full width let the clock
 * ("7:16") be picked up as a CP of 716. Keeping the middle removes that whole
 * class of error regardless of where the status bar sits.
 *
 * Several vertical offsets, because the first entry is tuned to one phone.
 * A different aspect ratio, a different notch, or a screenshot someone cropped
 * moves CP out of a single fixed window entirely — and it would fail hard
 * rather than degrade. The last entry is deliberately wide and tall as a
 * catch-all for a layout none of the others fit.
 */
const CP_REGIONS = [
  { left: 0.22, top: 0.03, width: 0.56, height: 0.11 },
  { left: 0.20, top: 0.06, width: 0.60, height: 0.12 },
  { left: 0.20, top: 0.00, width: 0.60, height: 0.09 },
  { left: 0.12, top: 0.02, width: 0.76, height: 0.20 },
];

const DETAIL_BAND_TOP = 0.42;
const DETAIL_BAND_HEIGHT = 0.48;

function toCanvas(bitmap: ImageBitmap, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const luminance = (px: Uint8ClampedArray, i: number) =>
  0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

/**
 * Luminance at a given percentile of the crop.
 *
 * Fixed cutoffs fail on the cases that matter: CP is near-white, and against a
 * bright background (sky, sand) a fixed threshold either keeps everything or
 * nothing. A percentile adapts to each screenshot automatically — the CP text
 * is always a small, bright fraction of a small crop, so "the brightest few
 * percent of pixels" locates it far more reliably than any constant.
 */
function percentileLuma(source: HTMLCanvasElement, percentile: number): number {
  const ctx = source.getContext('2d');
  if (!ctx) return 200;
  const { data } = ctx.getImageData(0, 0, source.width, source.height);

  const histogram = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    histogram[Math.round(luminance(data, i))]++;
    total++;
  }

  let seen = 0;
  const target = total * percentile;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen >= target) return v;
  }
  return 255;
}

/**
 * Keeps only pixels on one side of a luminance threshold and renders them as
 * black on white.
 *
 * `keepBright` picks out white text on a dark or saturated background, which
 * is the CP case. The inverse handles light-themed screens. We cannot know
 * which applies, so several are produced and tried in order.
 */
function threshold(source: HTMLCanvasElement, cutoff: number, keepBright: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source.toDataURL('image/png');

  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;

  for (let i = 0; i < px.length; i += 4) {
    const luma = luminance(px, i);
    const isText = keepBright ? luma >= cutoff : luma <= cutoff;
    const value = isText ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = value;
    px[i + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function crop(
  source: HTMLCanvasElement,
  { left, top, width, height }: { left: number; top: number; width: number; height: number },
  scale: number,
): HTMLCanvasElement {
  const sx = Math.round(source.width * left);
  const sy = Math.round(source.height * top);
  const sw = Math.round(source.width * width);
  const sh = Math.round(source.height * height);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function prepareImage(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = bitmap.width >= MIN_WIDTH ? 1 : MIN_WIDTH / bitmap.width;
    const full = toCanvas(bitmap, scale);

    // The band is small, so upscale it hard — OCR of a few large digits is
    // cheap and accuracy improves a lot with resolution.
    const cpBands = CP_REGIONS.map((region) => {
      const band = crop(full, region, 3);
      return [
        // Percentile cutoffs first: they adapt to the image, which fixed values
        // cannot do for white CP text over a bright sky. Fixed cutoffs stay as
        // backstops, occasionally better on flat backgrounds.
        threshold(band, percentileLuma(band, 0.93), true),
        threshold(band, percentileLuma(band, 0.86), true),
        threshold(band, percentileLuma(band, 0.97), true),
        threshold(band, 225, true),
        threshold(band, percentileLuma(band, 0.08), false),
        band.toDataURL('image/png'),
      ];
    });

    const detail = crop(
      full,
      { left: 0, top: DETAIL_BAND_TOP, width: 1, height: DETAIL_BAND_HEIGHT },
      1.8,
    );

    return {
      full: full.toDataURL('image/png'),
      detailBand: detail.toDataURL('image/png'),
      cpBands,
      width: full.width,
      height: full.height,
    };
  } finally {
    bitmap.close();
  }
}
