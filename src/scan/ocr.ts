import { parseCp, parseScreenshotText, type ScanCandidate } from './parse';
import { identifyFromStats, parseCandyFamily, parseTypes, type StatsMatch } from './identify';
import { prepareImage } from './image';
import { reconcile, type Reconciliation } from './reconcile';
import { levelsFromUpgradeCost, parseUpgradeCost, type LevelBand, type UpgradeCostReading } from './powerUp';

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
  /** Power-up cost read off the button, and the levels it implies. */
  upgradeCost: UpgradeCostReading | null;
  levelBand: LevelBand | null;
  /** Species consistent with the CP/HP pair — for renamed Pokémon with no name. */
  statsCandidates: StatsMatch[];
  /** CP/HP cross-check, when the species is known. */
  reconciliation: Reconciliation | null;
  /** Every OCR pass, so a bad scan can be diagnosed rather than guessed at. */
  debug: { pass: string; text: string }[];
}

type Worker = Awaited<ReturnType<typeof create>>;

/**
 * The Tesseract runtime is served from our own origin, staged into
 * public/tesseract/ by `npm run prepare:ocr`.
 *
 * The library's default is to build its worker from a blob URL and have that
 * worker importScripts() a CDN. That is a cross-origin load from an opaque
 * origin and it fails outright in some browsers — it failed on the deployed
 * site, while working in local dev, which is exactly the kind of difference
 * that only shows up once it is live. Same-origin assets also cache, so only
 * the first scan pays the download.
 */
async function create() {
  const { createWorker } = await import('tesseract.js');
  const base = import.meta.env.BASE_URL;
  return createWorker('eng', undefined, {
    workerPath: `${base}tesseract/worker.min.js`,
    // Directories: the library appends the core variant and language file it
    // decides it needs, which depends on the browser's SIMD support.
    corePath: `${base}tesseract/`,
    langPath: `${base}tesseract/`,
  });
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

/** A CP the OCR believes it saw, and how much that belief is worth. */
interface CpCandidate {
  value: number;
  /** True when the number sat next to a literal "CP" label. */
  labelled: boolean;
  pass: string;
}

/**
 * Reads CP candidates from the top of the image.
 *
 * Returns everything plausible rather than the first hit, because the first
 * hit is not reliably the right one: passes over the same image produce 2055
 * beside 2855, and 2563 beside 2583. A single wrong digit yields a perfectly
 * plausible CP that nothing downstream would question, which is the worst
 * failure this scanner can have. Choosing between them needs the HP
 * cross-check, which is not available here — so the choice is made by the
 * caller, in `chooseCp`.
 *
 * `shouldStop` lets the caller end the search once it has something it trusts,
 * so the common case still costs one band rather than all of them.
 */
async function readCpCandidates(
  worker: Worker,
  bands: string[][],
  debug: { pass: string; text: string }[],
  shouldStop: (found: CpCandidate[]) => boolean,
): Promise<CpCandidate[]> {
  // Only the whitelist. Forcing single-line segmentation (PSM 7) was tried and
  // measurably worse — it took CP from 4/5 to 0/5 on the sample screenshots.
  await worker.setParameters({ tessedit_char_whitelist: '0123456789CPcp ' });
  const found: CpCandidate[] = [];

  try {
    for (const [bandIndex, renderings] of bands.entries()) {
      for (const [i, image] of renderings.entries()) {
        const { data } = await worker.recognize(image);
        const text = data.text.trim();
        const pass = `cp-band-${bandIndex}.${i}`;
        debug.push({ pass, text });

        // Only numbers adjacent to a "CP" label. Accepting loose digits from
        // the band is exactly how the status bar clock became a CP of 716, and
        // the HP cross-check cannot reliably catch that: it admits a window of
        // roughly ±10%, so on a low-CP Pokémon a clock reading would sail
        // through unflagged. The label is the signal that a number is CP.
        const value = parseCp(text);
        if (value !== null && !found.some((f) => f.value === value)) {
          found.push({ value, labelled: true, pass });
        }
      }
      if (shouldStop(found)) break;
    }
    return found;
  } finally {
    // Leaving a whitelist set would silently wreck the next full-page pass.
    await worker.setParameters({ tessedit_char_whitelist: '' });
  }
}

/**
 * Picks which of several CP readings to believe.
 *
 * HP reads far more reliably than CP — small dark text on a white card, rather
 * than near-white text over artwork — so when the species is known it can
 * arbitrate between readings that all look plausible in isolation.
 *
 * Its resolution is limited and worth stating: for a known species, an HP value
 * admits a CP window of roughly ±10% (measured: ±255 on Skeledirge, ±400 on
 * Metagross). So it reliably rejects the gross errors that actually occur —
 * the status bar clock, a truncated digit, an inserted one — but it CANNOT
 * catch a single wrong digit mid-number. Do not treat agreement as proof.
 */
export function chooseCp(
  candidates: CpCandidate[],
  speciesId: string | null,
  hp: number | null,
): number | null {
  if (candidates.length === 0) return null;

  if (speciesId && hp !== null) {
    const agrees = candidates.find((c) => reconcile(speciesId, c.value, hp).consistent);
    if (agrees) return agrees.value;
  }

  // Nothing agreed, or there was nothing to check against. Show the first
  // reading anyway — reconcile flags it on the review screen, which is more
  // useful than an empty field the user has to fill in from scratch.
  return candidates[0].value;
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
    const candidates = await readCpCandidates(worker, prepared.cpBands, debug, (found) =>
      // Stop early once a candidate is both labelled and consistent with the
      // HP; searching further bands could only find a worse answer.
      found.some(
        (c) =>
          c.labelled &&
          (parsed.speciesId === null || parsed.hp === null ||
            reconcile(parsed.speciesId, c.value, parsed.hp).consistent),
      ),
    );
    const cp = chooseCp(candidates, parsed.speciesId, parsed.hp) ?? parsed.cp;

    onProgress?.({ file: file.name, progress: 0.75, status: 'reading power-up cost' });
    const { data: detail } = await worker.recognize(prepared.detailBand);
    debug.push({ pass: 'detail-band', text: detail.text.trim() });

    // Both passes see the lower half; combine them so whichever read the candy
    // label or the cost row better wins.
    const lowerText = `${data.text}\n${detail.text}`;

    onProgress?.({ file: file.name, progress: 0.9, status: 'matching' });
    const types = parseTypes(lowerText);
    const familyId = parseCandyFamily(lowerText);
    const upgradeCost = parseUpgradeCost(lowerText);
    const levelBand = upgradeCost ? levelsFromUpgradeCost(upgradeCost) : null;
    // Only worth computing when the name failed — that is the renamed case.
    const statsCandidates =
      parsed.speciesId === null && cp !== null && parsed.hp !== null
        ? identifyFromStats(cp, parsed.hp, { types: types as never[], familyId, levelBand })
        : [];

    results.push({
      ...parsed,
      reconciliation: parsed.speciesId
        ? reconcile(parsed.speciesId, cp, parsed.hp, levelBand)
        : null,
      cp,
      types,
      familyId,
      upgradeCost,
      levelBand,
      statsCandidates,
      file: file.name,
      previewUrl: URL.createObjectURL(file),
      debug,
    });
    onProgress?.({ file: file.name, progress: 1, status: 'done' });
  }

  return results;
}
