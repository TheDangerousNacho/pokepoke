import { combatPower, cpm } from './cpm';
import { getSpecies } from './gamemaster';
import type { IVs } from './stats';

const MAX_LEVEL = 51;

export interface LevelEstimate {
  level: number;
  /** CP the estimate produces, for showing the user how close the fit is. */
  cp: number;
  /** True when no level reproduces the scanned CP exactly. */
  approximate: boolean;
}

/**
 * Recovers a Pokémon's level from its CP.
 *
 * A screenshot shows CP but not level, and solving exactly needs IVs, which a
 * scan cannot see either. So this assumes IVs and finds the level whose CP
 * comes closest.
 *
 * The error this introduces is small in the direction that matters: IV spread
 * moves CP by only a few percent, and CP is dominated by level. Assuming a
 * hundo on a Pokémon that is actually 10/10/10 pulls the estimated level down
 * slightly, which understates its damage — the safe direction for a
 * "can we win" tool.
 */
export function estimateLevel(
  speciesId: string,
  cp: number,
  ivs: IVs = { attack: 15, defense: 15, stamina: 15 },
): LevelEstimate {
  const species = getSpecies(speciesId);

  let best: LevelEstimate | null = null;
  for (let level = 1; level <= MAX_LEVEL; level += 0.5) {
    const candidate = combatPower(species, ivs, level);
    const delta = Math.abs(candidate - cp);
    if (!best || delta < Math.abs(best.cp - cp)) {
      best = { level, cp: candidate, approximate: candidate !== cp };
    }
    // CP rises monotonically with level, so once we overshoot we are done.
    if (candidate > cp && best.cp >= cp) break;
  }

  if (!best) throw new Error(`could not estimate a level for ${speciesId} at CP ${cp}`);
  return best;
}

/** Highest CP this species can reach, for sanity-checking a scanned value. */
export function maxCp(speciesId: string, level = 50): number {
  return combatPower(getSpecies(speciesId), { attack: 15, defense: 15, stamina: 15 }, level);
}

/** Guards against an OCR misread producing an impossible Pokémon. */
export function isPlausibleCp(speciesId: string, cp: number): boolean {
  if (!Number.isInteger(cp) || cp < 10) return false;
  // Level 51 is the practical ceiling (best buddy on a level 50 Pokémon).
  return cp <= maxCp(speciesId, Math.min(51, cpmMaxLevel()));
}

const cpmMaxLevel = () => {
  // Guard against a future Game Master shipping a shorter CPM table.
  let level = 51;
  while (level > 1) {
    try {
      cpm(level);
      return level;
    } catch {
      level -= 0.5;
    }
  }
  return 1;
};
