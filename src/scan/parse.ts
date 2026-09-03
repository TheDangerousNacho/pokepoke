import { matchSpeciesName, type NameMatch } from './match';

export interface ScanCandidate {
  /** Best guess species id, or null when nothing matched confidently. */
  speciesId: string | null;
  /** Ranked alternatives for the review screen to offer. */
  matches: NameMatch[];
  cp: number | null;
  hp: number | null;
  /** The line the name guess came from, so the user can see what was read. */
  nameText: string | null;
  /** Raw OCR text, kept for debugging a bad scan. */
  rawText: string;
}

/**
 * Letters OCR substitutes for digits inside a number. Applied only when the
 * surrounding context is already known to be numeric (a CP or HP field), never
 * to free text, where it would mangle names.
 */
const DIGIT_LOOKALIKES: Record<string, string> = {
  O: '0', Q: '0', D: '0',
  I: '1', L: '1', T: '1',
  Z: '2', E: '3', A: '4',
  S: '5', G: '6', B: '8',
};

/** "3O56" -> 3056. Returns null if anything is left that isn't a digit. */
export function digitsFromOcr(token: string): number | null {
  const digits = token
    .toUpperCase()
    .split('')
    .map((c) => (/\d/.test(c) ? c : DIGIT_LOOKALIKES[c]))
    .join('');
  if (digits.length !== token.length || !/^\d+$/.test(digits)) return null;
  return Number(digits);
}

/**
 * Pulls CP out of OCR text.
 *
 * The label sits above the number in-game, so OCR usually emits "CP 1234" but
 * sometimes splits the line. Both forms are handled, and letter-for-digit
 * misreads inside the number are recovered — "CP 3O56" is common enough that
 * failing on it would send the user back to typing.
 *
 * Values outside 10-99999 are rejected rather than clipped: a wrong CP that
 * looks plausible is worse than no CP, because the review screen can ask.
 */
export function parseCp(text: string): number | null {
  const token = '[0-9OQDILTZEASGB]{2,5}';
  const patterns = [
    new RegExp(`\\bCP\\s*[:.]?\\s*(${token})\\b`, 'i'),
    new RegExp(`\\b(${token})\\s*CP\\b`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = digitsFromOcr(match[1]);
    if (value !== null && value >= 10 && value <= 99999) return value;
  }
  return null;
}

/** HP reads as "HP 123/123" — the second number is the max, which is what we want. */
export function parseHp(text: string): number | null {
  const match = /\bHP\s*[:.]?\s*(\d{1,4})\s*[/\\|]\s*(\d{1,4})\b/i.exec(text)
    ?? /\b(\d{1,4})\s*[/\\|]\s*(\d{1,4})\s*HP\b/i.exec(text);
  if (!match) return null;
  const max = Number(match[2]);
  return max >= 10 && max <= 9999 ? max : null;
}

/** Lines that are chrome, not a species name. */
const NOISE = /^(cp|hp|stardust|candy|power\s*up|evolve|weight|height|\d+|.{0,2})$/i;

/**
 * Finds the species name in OCR output.
 *
 * The name is not at a predictable line index — the label sits under the model
 * and OCR line order varies with crop and orientation. So every plausible line
 * is scored against the species list and the best match wins, which also makes
 * this robust to the surrounding chrome changing between game updates.
 */
export function parseSpecies(text: string): { matches: NameMatch[]; nameText: string | null } {
  const lines = text
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && !NOISE.test(l));

  let best: { matches: NameMatch[]; nameText: string } | null = null;
  for (const line of lines) {
    // Strip a trailing gender glyph and any stray punctuation OCR invents.
    const cleaned = line.replace(/[♀♂*·.,:;]+$/u, '').trim();
    const matches = matchSpeciesName(cleaned);
    if (matches.length === 0) continue;
    if (!best || matches[0].score > best.matches[0].score) {
      best = { matches, nameText: cleaned };
    }
  }

  return best ?? { matches: [], nameText: null };
}

/** Confidence below which the review screen should demand a human decision. */
export const CONFIDENT_MATCH = 0.8;

export function parseScreenshotText(rawText: string): ScanCandidate {
  const { matches, nameText } = parseSpecies(rawText);
  const top = matches[0];

  return {
    speciesId: top && top.score >= CONFIDENT_MATCH ? top.species.id : null,
    matches,
    cp: parseCp(rawText),
    hp: parseHp(rawText),
    nameText,
    rawText,
  };
}
