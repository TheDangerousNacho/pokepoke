import { getSpecies } from './gamemaster';
import { rateAttacker, type SimOptions } from './simulate';
import type { RaidBossSpec, RosterEntry } from './stats';

export interface MovesetRating {
  fastMove: string;
  chargedMove: string;
  /** Mean DPS across the bosses evaluated against. */
  dps: number;
  /** Mean total damage before fainting. */
  tdo: number;
  /** True if either move is Elite-TM-only for this species. */
  containsEliteMove: boolean;
  /**
   * Elite TMs that must actually be SPENT to reach this moveset from the
   * current one. Zero when the Pokémon already knows the legacy move — owning
   * it costs nothing to keep.
   */
  eliteSpend: number;
}

export interface MoveUpgrade {
  speciesId: string;
  current: MovesetRating;
  best: MovesetRating;
  /** Best moveset reachable without spending an Elite TM, if different. */
  bestWithoutElite: MovesetRating | null;
  /** DPS gain of `best` over `current`, as a fraction. */
  gain: number;
  /** Elite TMs needed to reach `best`: 0, 1 or 2. */
  eliteTms: number;
  /**
   * Expected number of ordinary TMs, which reroll randomly rather than letting
   * you choose. Only meaningful for changes not needing an Elite TM.
   */
  expectedRegularTms: number;
  /** Which slots change. */
  changes: Array<'fast' | 'charged'>;
  /** True when the current moveset uses a move only an Elite TM can restore. */
  losesLegacyMove: boolean;
  /** DPS gain per Elite TM spent — the number that ranks a scarce resource. */
  gainPerEliteTm: number;
}

/**
 * Ordinary TMs reroll to a random *different* move from the currently available
 * pool, so getting a specific one is not a single TM.
 *
 * With k moves in the pool, a reroll lands on any of the k-1 others with equal
 * chance, giving an expected k-1 attempts. If the Pokémon currently knows a
 * legacy move it is outside that pool, so every one of the k is reachable and
 * the expectation is k.
 */
function expectedRerolls(poolSize: number, currentIsInPool: boolean): number {
  if (poolSize <= 1) return currentIsInPool ? 0 : 1;
  return currentIsInPool ? poolSize - 1 : poolSize;
}

/** Mean DPS and TDO for one moveset across several bosses. */
function rateAcross(
  entry: RosterEntry,
  bosses: RaidBossSpec[],
  options: SimOptions,
): { dps: number; tdo: number } {
  let dps = 0;
  let tdo = 0;
  for (const boss of bosses) {
    const r = rateAttacker(entry, boss, options);
    dps += r.dps;
    tdo += r.tdo;
  }
  return { dps: dps / bosses.length, tdo: tdo / bosses.length };
}

/**
 * Evaluates every moveset a Pokémon could legally learn against a set of
 * bosses, and reports what a TM would buy.
 *
 * Only moves the Game Master lists as learnable — ordinary or Elite-TM-only —
 * are considered, so a move that has been retired entirely can never be
 * recommended. That is the "currently teachable" problem the plan expected to
 * need a hand-maintained community list for; the dump turns out to carry it.
 */
export interface EvaluateOptions extends SimOptions {
  /**
   * How much better an Elite-TM moveset must be than the best free one before
   * it is recommended at all, as a fraction of DPS.
   *
   * Without this the tool will happily tell you to burn an Elite TM for half a
   * percent, because that moveset is technically top of the list. Elite TMs are
   * the scarce resource the whole feature exists to allocate, so a marginal win
   * is not a reason to spend one.
   */
  eliteWorthThreshold?: number;
}

export function evaluateUpgrades(
  entry: RosterEntry,
  bosses: RaidBossSpec[],
  { eliteWorthThreshold = 0.02, ...options }: EvaluateOptions = {},
): MoveUpgrade {
  if (bosses.length === 0) throw new Error('need at least one boss to evaluate against');

  const species = getSpecies(entry.speciesId);
  const fastPool = species.fastMoves;
  const chargedPool = species.chargedMoves;
  const allFast = [...fastPool, ...species.eliteFastMoves];
  const allCharged = [...chargedPool, ...species.eliteChargedMoves];

  const isEliteFast = (m: string) => !fastPool.includes(m);
  const isEliteCharged = (m: string) => !chargedPool.includes(m);

  /**
   * Elite TMs that would actually be spent getting from the current moveset to
   * this one. A legacy move the Pokémon already knows is free to keep, so this
   * is not the same as "the moveset contains an elite move".
   */
  const spendFor = (fastMove: string, chargedMove: string) =>
    (fastMove !== entry.fastMove && isEliteFast(fastMove) ? 1 : 0) +
    (chargedMove !== entry.chargedMove && isEliteCharged(chargedMove) ? 1 : 0);

  const rate = (fastMove: string, chargedMove: string): MovesetRating => ({
    fastMove,
    chargedMove,
    ...rateAcross({ ...entry, fastMove, chargedMove }, bosses, options),
    containsEliteMove: isEliteFast(fastMove) || isEliteCharged(chargedMove),
    eliteSpend: spendFor(fastMove, chargedMove),
  });

  const all: MovesetRating[] = [];
  for (const fastMove of allFast) {
    for (const chargedMove of allCharged) all.push(rate(fastMove, chargedMove));
  }
  // Highest DPS first, but break ties toward the cheaper option: two movesets
  // that perform identically should never be presented as needing an Elite TM.
  all.sort((a, b) => b.dps - a.dps || a.eliteSpend - b.eliteSpend);

  const current = rate(entry.fastMove, entry.chargedMove);
  const withoutElite = all.find((m) => m.eliteSpend === 0) ?? null;

  // Only reach for an Elite TM when it buys a real margin over the free option.
  const top = all[0];
  const best =
    top.eliteSpend > 0 &&
    withoutElite &&
    top.dps < withoutElite.dps * (1 + eliteWorthThreshold)
      ? withoutElite
      : top;

  const changes: Array<'fast' | 'charged'> = [];
  if (best.fastMove !== current.fastMove) changes.push('fast');
  if (best.chargedMove !== current.chargedMove) changes.push('charged');

  const eliteTms = best.eliteSpend;

  let expectedRegularTms = 0;
  if (changes.includes('fast') && !isEliteFast(best.fastMove)) {
    expectedRegularTms += expectedRerolls(fastPool.length, !isEliteFast(current.fastMove));
  }
  if (changes.includes('charged') && !isEliteCharged(best.chargedMove)) {
    expectedRegularTms += expectedRerolls(chargedPool.length, !isEliteCharged(current.chargedMove));
  }

  const gain = current.dps > 0 ? best.dps / current.dps - 1 : 0;

  return {
    speciesId: entry.speciesId,
    current,
    best,
    // Only worth showing when it is both an improvement and a different answer
    // from `best` — otherwise it is the same row printed twice.
    bestWithoutElite:
      withoutElite &&
      withoutElite.dps > current.dps + 1e-9 &&
      (withoutElite.fastMove !== best.fastMove || withoutElite.chargedMove !== best.chargedMove)
        ? withoutElite
        : null,
    gain,
    eliteTms,
    expectedRegularTms,
    changes,
    // Rewriting a legacy move needs another Elite TM to undo, so it is worth
    // saying out loud even when the swap is an improvement.
    losesLegacyMove:
      (changes.includes('fast') && isEliteFast(current.fastMove)) ||
      (changes.includes('charged') && isEliteCharged(current.chargedMove)),
    gainPerEliteTm: eliteTms > 0 ? gain / eliteTms : gain,
  };
}

export interface UpgradeOptions extends EvaluateOptions {
  /** Ignore gains smaller than this fraction. Below ~3% it is noise. */
  minimumGain?: number;
}

/**
 * Ranks a whole roster by what a TM would buy.
 *
 * Sorted by gain per Elite TM rather than raw gain: Elite TMs are the scarce
 * resource, so the question is not "which Pokémon could improve most" but
 * "where does the next Elite TM do the most good". Upgrades needing no Elite TM
 * come first — they cost only ordinary TMs, which are plentiful.
 */
export function rankUpgrades(
  roster: RosterEntry[],
  bosses: RaidBossSpec[],
  { minimumGain = 0.03, ...options }: UpgradeOptions = {},
): MoveUpgrade[] {
  return roster
    .map((entry) => evaluateUpgrades(entry, bosses, options))
    .filter((u) => u.gain >= minimumGain)
    .sort((a, b) => {
      if ((a.eliteTms === 0) !== (b.eliteTms === 0)) return a.eliteTms === 0 ? -1 : 1;
      return b.gainPerEliteTm - a.gainPerEliteTm;
    });
}
