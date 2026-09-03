import { parseCp, parseScreenshotText, type ScanCandidate } from './parse';
import { identifyFromStats, parseCandyFamily, parseTypes, type StatsMatch } from './identify';
import { prepareImage } from './image';
import { reconcile, type Reconciliation } from './reconcile';

/**
 * Screenshot OCR.
 *
 * The user hands us an image file; we read text off it. Nothing here touches a
 * running game — no memory reads, no automated taps, no accessibility service.
 * That is what keeps this in the same category as Calcy IV rather than
 * anything resembling a bot.
 *
 * Tesseract is loaded on demand: it pulls several megabytes of WASM and
 * language data, and most sessions never open the scan tab.
 */

export interface ScanProgress {
  file: string;
  progress: number;
  status: string;
}

export interface ScanResult extends ScanCandidate {
  file: string;
  previewUrl: string;
  /** Types read off the badges, when legible. Narrows a renamed Pokémon a lot. */
  types: string[];
  /** Family from the candy label, e.g. FAMILY_EEVEE. */
  familyId: string | null;
  /** Species consistent with the CP/HP pair — for renamed Pokémon with no name. */
  statsCandidates: StatsMatch[];
  /** CP/HP cross-check, when the species is known. */
  reconciliation: Reconciliation | null;
  /** Every OCR pass, so a bad scan can be diagnosed rather than guessed at. */
  debug: { pass: string; text: string }[];
}

type Worker = Awaited<ReturnType<typeof create>>;

async function create() {
  const { createWorker } = await import('tesseract.js');
  return createWorker('eng');
}

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= create();
  return workerPromise;
}

export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

/**
 * Reads CP from the top band.
 *
 * Tried separately from the main pass with a digit whitelist, because CP is
 * the field that matters most and the one the full-page pass gets wrong most
 * often. Each rendering is tried until one produces a plausible number.
 */
async function readCp(
  worker: Worker,
  renderings: string[],
  debug: { pass: string; text: string }[],
): Promise<number | null> {
  // Only the whitelist. Forcing single-line segmentation (PSM 7) was tried and
  // measurably worse — it took CP from 4/5 to 0/5 on the sample screenshots.
  await worker.setParameters({ tessedit_char_whitelist: '0123456789CPcp ' });
  try {
    for (const [i, image] of renderings.entries()) {
      const { data } = await worker.recognize(image);
      debug.push({ pass: `cp-band-${i}`, text: data.text.trim() });

      // Only accept a number that is actually adjacent to a "CP" label. An
      // earlier version fell back to "any digits in the band", which happily
      // read the status bar clock as a CP of 716.
      const cp = parseCp(data.text);
      if (cp !== null) return cp;
    }
    return null;
  } finally {
    // Leaving a whitelist set would silently wreck the next full-page pass.
    await worker.setParameters({ tessedit_char_whitelist: '' });
  }
}

export async function scanScreenshots(
  files: File[],
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult[]> {
  const worker = await getWorker();
  const results: ScanResult[] = [];

  for (const file of files) {
    const debug: { pass: string; text: string }[] = [];
    onProgress?.({ file: file.name, progress: 0, status: 'preparing image' });
    const prepared = await prepareImage(file);

    onProgress?.({ file: file.name, progress: 0.25, status: 'reading name and HP' });
    const { data } = await worker.recognize(prepared.full);
    debug.push({ pass: 'full', text: data.text.trim() });
    const parsed = parseScreenshotText(data.text);

    onProgress?.({ file: file.name, progress: 0.6, status: 'reading CP' });
    const bandCp = await readCp(worker, prepared.cpBand, debug);
    const cp = bandCp ?? parsed.cp;

    onProgress?.({ file: file.name, progress: 0.9, status: 'matching' });
    const types = parseTypes(data.text);
    const familyId = parseCandyFamily(data.text);
    // Only worth computing when the name failed — that is the renamed case.
    const statsCandidates =
      parsed.speciesId === null && cp !== null && parsed.hp !== null
        ? identifyFromStats(cp, parsed.hp, { types: types as never[], familyId })
        : [];

    results.push({
      ...parsed,
      reconciliation: parsed.speciesId ? reconcile(parsed.speciesId, cp, parsed.hp) : null,
      cp,
      types,
      familyId,
      statsCandidates,
      file: file.name,
      previewUrl: URL.createObjectURL(file),
      debug,
    });
    onProgress?.({ file: file.name, progress: 1, status: 'done' });
  }

  return results;
}
