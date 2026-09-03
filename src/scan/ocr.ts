import type { ScanCandidate } from './parse';
import { parseScreenshotText } from './parse';

/**
 * Screenshot OCR.
 *
 * The user hands us an image file; we read text off it. Nothing here touches
 * a running game — no memory reads, no automated taps, no accessibility
 * service. That is the whole reason this stays in the same category as
 * Calcy IV rather than anything resembling a bot.
 *
 * Tesseract is loaded on demand: it pulls several megabytes of WASM and
 * language data, and most sessions never open the scan tab.
 */

export interface ScanProgress {
  file: string;
  /** 0-1 within the current file. */
  progress: number;
  status: string;
}

export interface ScanResult extends ScanCandidate {
  file: string;
  /** Object URL for the thumbnail; revoke when the review screen closes. */
  previewUrl: string;
}

type Worker = Awaited<ReturnType<typeof createWorker>>;

async function createWorker() {
  const { createWorker: create } = await import('tesseract.js');
  return create('eng');
}

let workerPromise: Promise<Worker> | null = null;

/** One worker, reused across a batch — startup dominates per-image cost. */
function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker();
  return workerPromise;
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

/**
 * Upscales small screenshots before OCR. Tesseract is markedly worse below
 * roughly 1000px wide, and phone screenshots scaled down by a share sheet
 * land there often.
 */
async function prepare(file: File): Promise<string | File> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const MIN_WIDTH = 1000;
  const scale = bitmap.width >= MIN_WIDTH ? 1 : MIN_WIDTH / bitmap.width;
  if (scale === 1) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/png');
}

export async function scanScreenshots(
  files: File[],
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult[]> {
  const worker = await getWorker();
  const results: ScanResult[] = [];

  for (const file of files) {
    onProgress?.({ file: file.name, progress: 0, status: 'preparing' });
    const input = await prepare(file);

    onProgress?.({ file: file.name, progress: 0.3, status: 'reading text' });
    const { data } = await worker.recognize(input);

    onProgress?.({ file: file.name, progress: 0.9, status: 'matching' });
    results.push({
      ...parseScreenshotText(data.text),
      file: file.name,
      previewUrl: URL.createObjectURL(file),
    });
    onProgress?.({ file: file.name, progress: 1, status: 'done' });
  }

  return results;
}
