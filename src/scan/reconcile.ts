import { combatPower, cpm } from '../engine/cpm';
import { getSpecies } from '../engine/gamemaster';
import { intersectLevels, type LevelBand } from './powerUp';

export interface Reconciliation {
  /** Best level estimate, or null when nothing could be derived. */
  level: number | null;
  /** Which readings the estimate rests on. */
  source: 'cp+hp' | 'hp' | 'cp' | 'none';
  /** False when CP and HP cannot both be true for this species. */
  consistent: boolean;
  /** CP range this species could show at the HP-implied levels. */
  expectedCp: { min: number; max: number } | null;
  /**
   * True when the level is a rough middle of several possibilities. HP alone
   * cannot pin a level: a high stamina IV at a low level and a low one at a
   * high level produce the same HP.
   */
  approximate: boolean;
}

const MAX_LEVEL = 51;
const IVS = Array.from({ length: 16 }, (_, i) => i);

/**
 * Picks a level from several that fit.
 *
 * The lowest is chosen deliberately. Reaching a higher level at the same CP
 * requires worse IVs, and players power up their good ones — so the low end is
 * the likelier reading. It is also the safer one: a lower level means lower
 * stats, which understates damage rather than promising a raid win the team
 * cannot deliver.
 */
const pickLevel = (levels: number[]) => Math.min(...levels);

/**
 * Cross-checks a scanned CP against the scanned HP for a known species.
 *
 * Worth doing because the two are read from different parts of the screen with
 * very different reliability: HP is small dark text on a white card and reads
 * almost perfectly, while CP is near-white text over arbitrary artwork and is
 * the field OCR mangles. So HP makes a good witness against a bad CP — a
 * truncated "2697" read as "269" is impossible alongside HP 153, and saying so
 * beats silently accepting it.
 */
export function reconcile(
  speciesId: string,
  cp: number | null,
  hp: number | null,
  /**
   * Levels allowed by the power-up cost. This is the strongest level signal
   * available — a discrete table lookup rather than an inference through
   * unknown IVs — so it is applied last, narrowing whatever CP and HP left open.
   */
  levelBand: LevelBand | null = null,
): Reconciliation {
  const species = getSpecies(speciesId);

  // Levels at which some stamina IV reproduces the HP exactly.
  const hpLevels: number[] = [];
  if (hp !== null) {
    for (let level = 1; level <= MAX_LEVEL; level += 0.5) {
      const multiplier = cpm(level);
      if (IVS.some((iv) => Math.floor((species.baseStamina + iv) * multiplier) === hp)) {
        hpLevels.push(level);
      }
    }
  }

  if (hpLevels.length === 0) {
    if (cp === null) return { level: null, source: 'none', consistent: true, expectedCp: null, approximate: false };
    // No HP to check against, so fall back to the CP alone.
    let best = 1;
    let bestDelta = Infinity;
    for (let level = 1; level <= MAX_LEVEL; level += 0.5) {
      const delta = Math.abs(combatPower(species, { attack: 15, defense: 15, stamina: 15 }, level) - cp);
      if (delta < bestDelta) { bestDelta = delta; best = level; }
    }
    return { level: best, source: 'cp', consistent: true, expectedCp: null, approximate: true };
  }

  const expectedCp = {
    min: Math.min(...hpLevels.map((l) => combatPower(species, { attack: 0, defense: 0, stamina: 0 }, l))),
    max: Math.max(...hpLevels.map((l) => combatPower(species, { attack: 15, defense: 15, stamina: 15 }, l))),
  };

  if (cp === null) {
    // HP alone pins a range of levels; take the middle as the estimate.
    return {
      level: pickLevel(intersectLevels(levelBand, hpLevels)),
      source: 'hp',
      consistent: true,
      expectedCp,
      approximate: intersectLevels(levelBand, hpLevels).length > 1,
    };
  }

  if (cp < expectedCp.min || cp > expectedCp.max) {
    // The CP is impossible given the HP. Trust HP — it is the more reliable read.
    return {
      level: pickLevel(hpLevels),
      source: 'hp',
      consistent: false,
      expectedCp,
      approximate: true,
    };
  }

  // Both agree. Narrow to levels where some INTEGER IV spread reproduces both
  // readings exactly — the CP range at a level spans 0/0/0 to 15/15/15 and is
  // wide enough that merely "inside the range" left the estimate 5 levels high.
  const exact = hpLevels.filter((level) => {
    const multiplier = cpm(level);
    const staminas = IVS.filter(
      (iv) => Math.floor((species.baseStamina + iv) * multiplier) === hp,
    );
    return staminas.some((stamina) =>
      IVS.some((attack) =>
        IVS.some((defense) => combatPower(species, { attack, defense, stamina }, level) === cp),
      ),
    );
  });

  if (exact.length === 0) {
    // Individually plausible but jointly impossible — treat as a bad CP read.
    return {
      level: pickLevel(hpLevels),
      source: 'hp',
      consistent: false,
      expectedCp,
      approximate: true,
    };
  }

  const narrowed = intersectLevels(levelBand, exact);
  return {
    level: pickLevel(narrowed),
    source: 'cp+hp',
    consistent: true,
    expectedCp,
    approximate: narrowed.length > 1,
  };
}
