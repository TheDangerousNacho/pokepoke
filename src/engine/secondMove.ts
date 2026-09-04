import { getSpecies } from './gamemaster';
import { rateAttacker, type SimOptions } from './simulate';
import type { RaidBossSpec, RosterEntry } from './stats';

export interface SecondMoveRecommendation {
  speciesId: string;
  fastMove: string;
  /** The better half of the pair — the one worth having in either case. */
  primary: string;
  /** The move the second slot is for. */
  addition: string;
  /** True when `primary` is not a move this Pokémon currently knows. */
  needsTmFirst: boolean;
  /** Mean DPS across the bosses with the best SINGLE charged move. */
  singleDps: number;
  /** Mean DPS when each boss gets the better of the pair. */
  pairDps: number;
  /** pairDps over singleDps, as a fraction. */
  gain: number;
  cost: { stardust: number; candy: number };
  /** Bosses where the addition is the move you would actually fire. */
  helpsAgainst: RaidBossSpec[];
}

export interface SecondMoveOptions extends SimOptions {
  /**
   * Ignore gains smaller than this fraction.
   *
   * Higher than the TM tab's 3% on purpose: an unlock costs 10,000-100,000
   * stardust, which is several power-up levels competing for the same pile.
   * A TM is cheap enough that a marginal gain is still worth taking; this is
   * not.
   */
  minimumGain?: number;
}

/**
 * Is a second charged move worth the stardust?
 *
 * The point of a second move is not more damage in one fight — you would just
 * use the better move — it is that the same Pokémon becomes the right answer
 * to more of the rotation. So the value measured here is exactly that: the
 * mean DPS when every boss gets the better of a pair, over the mean DPS of the
 * best single move.
 *
 * **The baseline is the best single move, not the one currently equipped.**
 * Measured against what the Pokémon has today, an unlock would take credit for
 * an improvement an ordinary TM buys far more cheaply, and the tool would
 * recommend spending 75,000 dust to get something a TM already offers. Same
 * reasoning as the Elite TM threshold: a recommendation has to beat the
 * cheaper way of getting there, not just beat doing nothing.
 *
 * Elite-TM-only moves are not considered: the unlock draws from the ordinary
 * pool, and advice nobody can act on is not advice.
 */
export function evaluateSecondMove(
  entry: RosterEntry,
  bosses: RaidBossSpec[],
  options: SimOptions = {},
): SecondMoveRecommendation | null {
  if (bosses.length === 0) throw new Error('need at least one boss to evaluate against');
  if (entry.chargedMove2) return null;

  const species = getSpecies(entry.speciesId);
  const cost = species.secondMoveCost;
  const pool = species.chargedMoves;
  if (!cost || pool.length < 2) return null;

  // dps[move][boss], from the same simulation everything else uses.
  const dps = new Map<string, number[]>();
  for (const chargedMove of pool) {
    dps.set(
      chargedMove,
      bosses.map((boss) =>
        rateAttacker({ ...entry, chargedMove, chargedMove2: undefined }, boss, options).dps),
    );
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  let bestSingle = pool[0];
  for (const move of pool) {
    if (mean(dps.get(move)!) > mean(dps.get(bestSingle)!)) bestSingle = move;
  }

  let best: { primary: string; addition: string; dps: number } | null = null;
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = dps.get(pool[i])!;
      const b = dps.get(pool[j])!;
      const paired = mean(a.map((v, k) => Math.max(v, b[k])));
      if (!best || paired > best.dps) {
        // Name the stronger half as the primary, so the pair reads as "the
        // move you rely on, plus the one for the fights it is wrong for".
        const aFirst = mean(a) >= mean(b);
        best = {
          primary: aFirst ? pool[i] : pool[j],
          addition: aFirst ? pool[j] : pool[i],
          dps: paired,
        };
      }
    }
  }
  if (!best) return null;

  const singleDps = mean(dps.get(bestSingle)!);
  const primaryDps = dps.get(best.primary)!;
  const additionDps = dps.get(best.addition)!;

  return {
    speciesId: entry.speciesId,
    fastMove: entry.fastMove,
    primary: best.primary,
    addition: best.addition,
    needsTmFirst: best.primary !== entry.chargedMove,
    singleDps,
    pairDps: best.dps,
    gain: singleDps > 0 ? best.dps / singleDps - 1 : 0,
    cost,
    helpsAgainst: bosses.filter((_, k) => additionDps[k] > primaryDps[k]),
  };
}

/**
 * Ranks a roster by whether a second charged move is worth unlocking.
 *
 * Sorted by gain per 10,000 stardust rather than raw gain, because stardust is
 * the constraint: the question is not "which Pokémon would improve most" but
 * "where does the next chunk of dust do the most good". A cheap common
 * Pokémon can beat a legendary that gains slightly more for twice the price.
 */
export function rankSecondMoves(
  roster: RosterEntry[],
  bosses: RaidBossSpec[],
  { minimumGain = 0.05, ...options }: SecondMoveOptions = {},
): SecondMoveRecommendation[] {
  return roster
    .map((entry) => evaluateSecondMove(entry, bosses, options))
    .filter((r): r is SecondMoveRecommendation => r !== null && r.gain >= minimumGain)
    .sort((a, b) => b.gain / b.cost.stardust - a.gain / a.cost.stardust);
}
