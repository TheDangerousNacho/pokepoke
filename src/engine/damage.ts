import { gm, getMove, stab, typeEffectiveness } from './gamemaster';
import type { Combatant } from './stats';
import type { Move, PokemonType, WeatherCondition } from './types';

/**
 * Conditions that modify damage but are not properties of either combatant.
 * All fields are optional so a bare `damage(a, b, move)` gives the unmodified
 * matchup, which is what most tests want.
 */
export interface BattleConditions {
  weather?: WeatherCondition;
  /**
   * Friendship level with the trainers you are raiding alongside, 0-5.
   * Applies to the player's damage only, and only in a group — a true solo
   * raid has no friendship bonus.
   */
  friendshipLevel?: number;
  /** A mega in the lobby boosts every attacker: 1.3 same type, 1.1 otherwise. */
  megaBoostTypes?: PokemonType[];
  /** Dodging is out of scope for the v1 sim, but the constant is wired up. */
  dodged?: boolean;
}

/** True when the current weather boosts this move's type. */
export function isWeatherBoosted(moveType: PokemonType, weather?: WeatherCondition): boolean {
  if (!weather) return false;
  return gm.weatherAffinities[weather].includes(moveType);
}

function friendshipMultiplier(level?: number): number {
  if (!level) return 1;
  const table = gm.friendshipAttackMultipliers;
  if (level < 0 || level >= table.length) throw new Error(`friendship level out of range: ${level}`);
  return table[level];
}

function megaMultiplier(moveType: PokemonType, megaTypes?: PokemonType[]): number {
  if (!megaTypes?.length) return 1;
  return megaTypes.includes(moveType)
    ? gm.settings.megaBoostSameType
    : gm.settings.megaBoostDifferentType;
}

/**
 * The product of every multiplier applied to a hit. Split out from `damage`
 * so the sim can cache it: within one matchup only the combatants' stats
 * change, never these.
 */
export function damageMultiplier(
  attacker: Pick<Combatant, 'types'>,
  defender: Pick<Combatant, 'types'>,
  move: Move,
  conditions: BattleConditions = {},
): number {
  return (
    stab(move.type, attacker.types) *
    typeEffectiveness(move.type, defender.types) *
    (isWeatherBoosted(move.type, conditions.weather) ? gm.settings.weatherBonus : 1) *
    friendshipMultiplier(conditions.friendshipLevel) *
    megaMultiplier(move.type, conditions.megaBoostTypes) *
    (conditions.dodged ? 1 - gm.settings.dodgeDamageReductionPercent : 1)
  );
}

/**
 * Damage for a single hit:
 *
 *   floor(0.5 × power × attack / defense × modifiers) + 1
 *
 * The trailing +1 is why every hit lands for at least 1, and why the floor
 * matters: rounding before adding, not after.
 */
export function damage(
  attacker: Pick<Combatant, 'types' | 'attack'>,
  defender: Pick<Combatant, 'types' | 'defense'>,
  move: Move | string,
  conditions: BattleConditions = {},
): number {
  const m = typeof move === 'string' ? getMove(move) : move;
  const multiplier = damageMultiplier(attacker, defender, m, conditions);
  return Math.floor(0.5 * m.power * (attacker.attack / defender.defense) * multiplier) + 1;
}

/**
 * Energy the defender gains from taking a hit. In raids the boss builds energy
 * from damage received, which is what makes its charged moves land when they do.
 */
export function energyFromDamageTaken(damageDealt: number): number {
  return Math.ceil(damageDealt * gm.settings.bossEnergyRegenerationPerHealthLost);
}

/** Damage per second of a move used on cooldown, ignoring energy constraints. */
export function moveDps(
  attacker: Pick<Combatant, 'types' | 'attack'>,
  defender: Pick<Combatant, 'types' | 'defense'>,
  move: Move | string,
  conditions: BattleConditions = {},
): number {
  const m = typeof move === 'string' ? getMove(move) : move;
  return damage(attacker, defender, m, conditions) / (m.durationMs / 1000);
}

/** Energy generated per second by a fast move. */
export function energyPerSecond(move: Move | string): number {
  const m = typeof move === 'string' ? getMove(move) : move;
  return m.energy / (m.durationMs / 1000);
}
