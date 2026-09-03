import bundle from '../data/gamemaster.json';
import type { GameMaster, Move, PokemonType, Species } from './types';

export const gm = bundle as unknown as GameMaster;

export function getSpecies(id: string): Species {
  const s = gm.species[id];
  if (!s) throw new Error(`unknown species: ${id}`);
  return s;
}

export function getMove(id: string): Move {
  const m = gm.moves[id];
  if (!m) throw new Error(`unknown move: ${id}`);
  return m;
}

/** Combined type effectiveness of `attackType` against a defender's type(s). */
export function typeEffectiveness(attackType: PokemonType, defenderTypes: PokemonType[]): number {
  const row = gm.typeChart[attackType];
  return defenderTypes.reduce((mult, t) => mult * row[gm.types.indexOf(t)], 1);
}

/** 1.2 when the move's type matches one of the attacker's types. */
export function stab(moveType: PokemonType, attackerTypes: PokemonType[]): number {
  return attackerTypes.includes(moveType) ? gm.settings.stab : 1;
}
