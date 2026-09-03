import { gm } from './gamemaster';

const MAX_LEVEL = gm.cpMultipliers.length;

/**
 * CP multiplier for a Pokémon level. The Game Master only ships whole levels;
 * half levels use the quadratic mean of the two neighbours, which is how the
 * client derives them.
 */
export function cpm(level: number): number {
  if (!Number.isFinite(level) || level < 1 || level > MAX_LEVEL) {
    throw new Error(`level out of range: ${level}`);
  }
  if (level * 2 !== Math.floor(level * 2)) {
    throw new Error(`level must be a whole or half step: ${level}`);
  }

  const whole = Math.floor(level);
  const lower = gm.cpMultipliers[whole - 1];
  if (whole === level) return lower;

  const upper = gm.cpMultipliers[whole] ?? lower;
  return Math.sqrt((lower * lower + upper * upper) / 2);
}

/** Effective stat: (base + IV) × CPM. */
export function effectiveStat(base: number, iv: number, level: number): number {
  return (base + iv) * cpm(level);
}

/** In-game CP. Used to let the user confirm a manually entered Pokémon matches. */
export function combatPower(
  s: { baseAttack: number; baseDefense: number; baseStamina: number },
  ivs: { attack: number; defense: number; stamina: number },
  level: number,
): number {
  const m = cpm(level);
  const atk = (s.baseAttack + ivs.attack) * m;
  const def = (s.baseDefense + ivs.defense) * m;
  const sta = (s.baseStamina + ivs.stamina) * m;
  return Math.max(10, Math.floor((atk * Math.sqrt(def) * Math.sqrt(sta)) / 10));
}
