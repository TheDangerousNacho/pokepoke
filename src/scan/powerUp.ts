import { gm } from '../engine/gamemaster';

export interface UpgradeCostReading {
  stardust: number;
  candy: number;
}

export interface LevelBand {
  levels: number[];
  min: number;
  max: number;
}

/**
 * Levels consistent with a power-up cost.
 *
 * This is the only signal on the detail screen that pins a Pokémon's level
 * directly — CP and HP together leave several levels open, because a high IV
 * spread low down and a low one higher up produce the same pair. The costs are
 * a step function, so a reading narrows the level to one or two whole levels
 * (four half-steps at most), which is far tighter.
 *
 * Costs are the same for both half-steps within a whole level, so a reading can
 * never distinguish 30 from 30.5.
 */
export function levelsFromUpgradeCost(
  { stardust, candy }: UpgradeCostReading,
  { isShadow = false, isPurified = false }: { isShadow?: boolean; isPurified?: boolean } = {},
): LevelBand | null {
  const costs = gm.upgradeCosts;

  // Shadow and purified Pokémon cost more and less respectively, so undo the
  // multiplier before matching rather than storing three copies of the table.
  const dustMultiplier = isShadow
    ? costs.shadowStardustMultiplier
    : isPurified
      ? costs.purifiedStardustMultiplier
      : 1;
  const candyMultiplier = isShadow
    ? costs.shadowCandyMultiplier
    : isPurified
      ? costs.purifiedCandyMultiplier
      : 1;

  const levels: number[] = [];
  for (let i = 0; i < costs.stardust.length; i++) {
    const expectedDust = Math.round(costs.stardust[i] * dustMultiplier);
    const expectedCandy = Math.round(costs.candy[i] * candyMultiplier);
    if (expectedDust !== stardust) continue;
    // Candy is 0 in the table above level 39, where XL candy takes over; do not
    // let that silently match a real reading of zero candy.
    if (expectedCandy !== candy || expectedCandy === 0) continue;

    const whole = i + 1;
    levels.push(whole, whole + 0.5);
  }

  if (levels.length === 0) return null;
  return { levels, min: Math.min(...levels), max: Math.max(...levels) };
}

/**
 * Reads the power-up cost off OCR text.
 *
 * The costs sit on the POWER UP button as a stardust figure and a candy figure.
 * Both are matched against the cost table jointly, which is what makes this
 * safe: the screen also shows a stardust *balance* (six digits) and candy
 * *holdings*, and requiring the pair to agree on a single level rejects those.
 */
/**
 * Interpretations of one OCR number token.
 *
 * The stardust and candy icons sit immediately left of their figures and OCR
 * regularly folds them into the number — "5,000" comes back as "15000" and a
 * candy count of 6 as "26". So each token is also tried with its leading digit
 * removed. That is safe here only because the dust and candy figures must
 * jointly agree on a single level, which rejects the spurious readings.
 */
function interpretations(token: string): number[] {
  const digits = token.replace(/[,.]/g, '');
  const out = [Number(digits)];
  if (digits.length > 1) out.push(Number(digits.slice(1)));
  return out.filter((n) => Number.isFinite(n) && n > 0);
}

export function parseUpgradeCost(text: string): UpgradeCostReading | null {
  const tokens = [...text.matchAll(/\b(\d{1,3}(?:[,.]\d{3})+|\d{1,6})\b/g)].map((m) => m[1]);
  const costs = gm.upgradeCosts;
  const validDust = new Set(costs.stardust);

  // Walk adjacent pairs: the button renders dust then candy, in that order.
  for (let i = 0; i < tokens.length - 1; i++) {
    for (const stardust of interpretations(tokens[i])) {
      if (!validDust.has(stardust)) continue;

      for (const next of tokens.slice(i + 1, i + 3)) {
        for (const candy of interpretations(next)) {
          if (levelsFromUpgradeCost({ stardust, candy })) return { stardust, candy };
        }
      }
    }
  }
  return null;
}

/** Intersects a level band with other candidate levels. */
export function intersectLevels(band: LevelBand | null, levels: number[]): number[] {
  if (!band) return levels;
  const allowed = new Set(band.levels);
  const kept = levels.filter((l) => allowed.has(l));
  // If they disagree entirely, the cost reading is the more trustworthy one:
  // it is a discrete table lookup, not an inference through unknown IVs.
  return kept.length > 0 ? kept : levels;
}
