import packed from '../data/gamemaster.json' with { type: 'json' };
import type { GameMaster, MegaForm, Move, PokemonType, Rarity, Species, WeatherCondition } from './types';

/**
 * The shipped bundle is packed: move names are interned into one id table and
 * every record is a positional tuple, which takes it from 460KB to ~108KB.
 * `unpack` is the exact inverse of `pack` in scripts/build-gamemaster.mjs, and
 * runs once at module load.
 */

type PackedMove = [type: number, category: number, power: number, energy: number,
                   durationMs: number, dwStart: number, dwEnd: number];

type PackedMega = [id: string, types: number[], atk: number, def: number, sta: number];

type PackedSpecies = [
  id: string, basePokemonId: string | null, dex: number, types: number[],
  atk: number, def: number, sta: number,
  fast: number[], charged: number[], eliteFast: number[], eliteCharged: number[],
  hasShadow: number, rarity: number, megas: PackedMega[], family: number,
];

interface PackedBundle {
  format: number;
  source: GameMaster['source'];
  types: PokemonType[];
  typeChart: number[][];
  cpMultipliers: number[];
  settings: GameMaster['settings'];
  upgradeCosts: GameMaster['upgradeCosts'];
  friendshipAttackMultipliers: number[];
  weatherAffinities: Record<string, number[]>;
  moveIds: string[];
  familyIds: string[];
  moves: PackedMove[];
  species: PackedSpecies[];
}

/** Packed as an index by the build script; the order is the wire format. */
const RARITIES: Rarity[] = ['NORMAL', 'LEGENDARY', 'MYTHIC', 'ULTRA_BEAST'];

function unpack(p: PackedBundle): GameMaster {
  if (p.format !== 5) {
    throw new Error(`gamemaster.json is format ${p.format}; run \`npm run build:gm\``);
  }
  const type = (i: number) => p.types[i];

  const moves: Record<string, Move> = {};
  p.moveIds.forEach((id, i) => {
    const [t, category, power, energy, durationMs, damageWindowStartMs, damageWindowEndMs] = p.moves[i];
    moves[id] = {
      id,
      type: type(t),
      category: category === 0 ? 'fast' : 'charged',
      power, energy, durationMs, damageWindowStartMs, damageWindowEndMs,
    };
  });

  const species: Record<string, Species> = {};
  for (const s of p.species) {
    const [id, basePokemonId, dex, types, baseAttack, baseDefense, baseStamina,
           fast, charged, eliteFast, eliteCharged, hasShadow, rarity, megas, family] = s;
    const name = (i: number) => p.moveIds[i];

    species[id] = {
      id,
      // A base form stores no separate pokemonId, and a variant's form IS its id.
      pokemonId: basePokemonId ?? id,
      form: basePokemonId === null ? null : id,
      dex,
      familyId: family === -1 ? null : p.familyIds[family],
      types: types.map(type),
      baseAttack, baseDefense, baseStamina,
      fastMoves: fast.map(name),
      chargedMoves: charged.map(name),
      eliteFastMoves: eliteFast.map(name),
      eliteChargedMoves: eliteCharged.map(name),
      hasShadow: hasShadow === 1,
      rarity: RARITIES[rarity],
      megas: megas.map(([mid, mtypes, atk, def, sta]): MegaForm => ({
        id: mid,
        types: mtypes.map(type),
        baseAttack: atk,
        baseDefense: def,
        baseStamina: sta,
      })),
    };
  }

  const typeChart = {} as Record<PokemonType, number[]>;
  p.types.forEach((name, i) => { typeChart[name] = p.typeChart[i]; });

  const weatherAffinities = {} as Record<WeatherCondition, PokemonType[]>;
  for (const [condition, list] of Object.entries(p.weatherAffinities)) {
    weatherAffinities[condition as WeatherCondition] = list.map(type);
  }

  return {
    source: p.source,
    types: p.types,
    typeChart,
    cpMultipliers: p.cpMultipliers,
    settings: p.settings,
    upgradeCosts: p.upgradeCosts,
    friendshipAttackMultipliers: p.friendshipAttackMultipliers,
    weatherAffinities,
    moves,
    species,
  };
}

export const gm = unpack(packed as unknown as PackedBundle);

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
