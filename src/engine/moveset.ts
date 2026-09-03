import { damage } from './damage';
import { getMove, getSpecies } from './gamemaster';
import type { PokemonType } from './types';

/** Stand-in attacker/defender used to rank pairings; absolute values are
 *  irrelevant because every candidate is scored against the same pair. */
export const referenceAttacker = (speciesId: string) => {
  const s = getSpecies(speciesId);
  return { attack: s.baseAttack, types: s.types };
};
export const referenceDefender = (types: PokemonType[]) => ({ defense: 100, types });

export interface MovesetChoice {
  fastMove: string;
  chargedMove: string;
  /** Cycle DPS against the reference defender. */
  dps: number;
}

/**
 * Closed-form DPS of one fast/charged pairing against a reference defender.
 * Exported so callers (and tests) can score a specific pairing, not just the
 * best one.
 *
 * Cycles fast moves until the charged move is affordable, cycling fast moves until the
 * charged move is affordable and then firing it.
 *
 * This is a ranking heuristic, not a simulation: it ignores energy carried
 * between cycles, faints, and the boss's own timeline. Good enough to pick a
 * sensible default moveset; use the simulation for actual numbers.
 */
export function cycleDps(
  attacker: { attack: number; types: PokemonType[] },
  defender: { defense: number; types: PokemonType[] },
  fastId: string,
  chargedId: string,
): number {
  const fast = getMove(fastId);
  const charged = getMove(chargedId);
  if (fast.energy <= 0) return 0;

  const casts = Math.ceil(Math.abs(charged.energy) / fast.energy);
  const cycleMs = casts * fast.durationMs + charged.durationMs;
  const cycleDamage =
    casts * damage(attacker, defender, fast) + damage(attacker, defender, charged);

  return cycleDamage / (cycleMs / 1000);
}

/**
 * Best moveset a species can learn against a given defender.
 *
 * Elite (Elite-TM-only) moves are excluded by default: defaulting a new roster
 * entry to a move the user probably does not have would quietly overstate
 * their team. They can still pick one manually.
 */
export function bestMoveset(
  speciesId: string,
  defenderTypes: PokemonType[] = ['NORMAL'],
  { includeElite = false } = {},
): MovesetChoice | null {
  const species = getSpecies(speciesId);
  const fastMoves = includeElite ? [...species.fastMoves, ...species.eliteFastMoves] : species.fastMoves;
  const chargedMoves = includeElite
    ? [...species.chargedMoves, ...species.eliteChargedMoves]
    : species.chargedMoves;
  if (fastMoves.length === 0 || chargedMoves.length === 0) return null;

  // Defense is a constant scale factor across every candidate, so its value
  // does not affect the ranking — only the defender's types do.
  const attacker = referenceAttacker(speciesId);
  const defender = referenceDefender(defenderTypes);

  let best: MovesetChoice | null = null;
  for (const fastMove of fastMoves) {
    for (const chargedMove of chargedMoves) {
      const dps = cycleDps(attacker, defender, fastMove, chargedMove);
      if (!best || dps > best.dps) best = { fastMove, chargedMove, dps };
    }
  }
  return best;
}
