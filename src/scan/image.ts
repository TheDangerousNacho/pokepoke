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
  /** Renderings of the CP band at the top, in the order worth trying. */
  cpBand: string[];
  width: number;
  height: number;
}

/** Tesseract degrades sharply below roughly this width. */
const MIN_WIDTH = 1000;

/** CP sits in the top band of the detail screen, above the model. */
const CP_BAND_TOP = 0.02;
const CP_BAND_HEIGHT = 0.16;

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

/**
 * Keeps only pixels on one side of a luminance threshold and renders them as
 * black on white.
 *
 * `keepBright` picks out white text on a dark or saturated background, which
 * is the CP case. The inverse handles the light-themed screens and the odd
 * screenshot taken against a pale background — we cannot know which applies,
 * so both get produced and tried.
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
    // Rec. 601 luma; good enough and cheap.
    const luma = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const isText = keepBright ? luma >= cutoff : luma <= cutoff;
    const value = isText ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = value;
    px[i + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}

function crop(source: HTMLCanvasElement, top: number, height: number, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    source,
    0, Math.round(source.height * top), source.width, Math.round(source.height * height),
    0, 0, canvas.width, canvas.height,
  );
  return canvas;
}

export async function prepareImage(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = bitmap.width >= MIN_WIDTH ? 1 : MIN_WIDTH / bitmap.width;
    const full = toCanvas(bitmap, scale);

    // The band is small, so upscale it hard — OCR of a few large digits is
    // cheap and accuracy improves a lot with resolution.
    const band = crop(full, CP_BAND_TOP, CP_BAND_HEIGHT, 2);

    return {
      full: full.toDataURL('image/png'),
      cpBand: [
        threshold(band, 170, true),   // white CP text over a coloured header
        threshold(band, 110, false),  // dark CP text over a light header
        band.toDataURL('image/png'),  // untouched, in case thresholding hurt
      ],
      width: full.width,
      height: full.height,
    };
  } finally {
    bitmap.close();
  }
}
