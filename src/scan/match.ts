import { ALL_SPECIES, type SpeciesOption } from '../ui/search';

export interface NameMatch {
  species: SpeciesOption;
  /** 0-1, where 1 is an exact match after normalisation. */
  score: number;
}

/**
 * OCR reliably confuses a handful of glyph pairs, so both the query and the
 * species list are folded through the same map before comparing.
 *
 * Folding is applied AFTER uppercasing, so the patterns are uppercase too —
 * a lowercase /rn/ would silently never fire. Multi-letter folds like RN->M
 * can in principle corrupt a name that legitimately contains "RN", but that
 * is harmless here precisely because both sides go through this function: the
 * corruption is symmetric and the match still lands.
 */
const CONFUSIONS: Array<[RegExp, string]> = [
  [/RN/g, 'M'],
  [/VV/g, 'W'],
  [/0/g, 'O'],
  [/[1|!]/g, 'I'],
  [/5/g, 'S'],
  [/8/g, 'B'],
  [/2/g, 'Z'],
];

export function normaliseForOcr(text: string): string {
  let out = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (const [pattern, replacement] of CONFUSIONS) out = out.replace(pattern, replacement);
  return out;
}

/** Levenshtein distance, iterative with a single row buffer. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

const similarity = (a: string, b: string) =>
  a.length === 0 && b.length === 0 ? 1 : 1 - editDistance(a, b) / Math.max(a.length, b.length);

/** Precomputed so matching a batch of screenshots doesn't renormalise 1194 names. */
const INDEX: Array<{ option: SpeciesOption; key: string }> = ALL_SPECIES.map((option) => ({
  option,
  key: normaliseForOcr(option.name),
}));

/**
 * Best species matches for a scanned name.
 *
 * Returns several candidates rather than one: OCR gets names wrong often
 * enough that the review screen needs alternatives to offer, and picking
 * silently would put a wrong Pokémon in the roster.
 */
export function matchSpeciesName(text: string, limit = 5): NameMatch[] {
  const query = normaliseForOcr(text);
  if (query.length < 3) return [];

  return INDEX.map(({ option, key }) => {
    // A short query that is a clean prefix of a longer name (OCR clipping the
    // end) should score better than raw edit distance allows.
    const prefixBonus = key.startsWith(query) ? 0.15 : 0;
    return { species: option, score: Math.min(1, similarity(query, key) + prefixBonus) };
  })
    .filter((m) => m.score > 0.45)
    .sort((a, b) => b.score - a.score || a.species.dex - b.species.dex)
    .slice(0, limit);
}
