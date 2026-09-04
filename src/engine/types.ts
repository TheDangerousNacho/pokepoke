/** Canonical Pokémon type names, in the Game Master's `attackScalar` index order. */
export type PokemonType =
  | 'NORMAL' | 'FIGHTING' | 'FLYING' | 'POISON' | 'GROUND' | 'ROCK'
  | 'BUG' | 'GHOST' | 'STEEL' | 'FIRE' | 'WATER' | 'GRASS'
  | 'ELECTRIC' | 'PSYCHIC' | 'ICE' | 'DRAGON' | 'DARK' | 'FAIRY';

export type MoveCategory = 'fast' | 'charged';

export interface Move {
  id: string;
  type: PokemonType;
  category: MoveCategory;
  power: number;
  /** Positive for fast moves (energy gained), negative for charged (energy spent). */
  energy: number;
  durationMs: number;
  damageWindowStartMs: number;
  damageWindowEndMs: number;
}

export interface MegaForm {
  id: string;
  types: PokemonType[];
  baseAttack: number;
  baseDefense: number;
  baseStamina: number;
}

export type Rarity = 'NORMAL' | 'LEGENDARY' | 'MYTHIC' | 'ULTRA_BEAST';

export interface Species {
  /** Bundle key: the base form uses `pokemonId`, variants use their form name. */
  id: string;
  pokemonId: string;
  form: string | null;
  dex: number;
  /** e.g. FAMILY_EEVEE. Null when the dump omits it. */
  familyId: string | null;
  types: PokemonType[];
  baseAttack: number;
  baseDefense: number;
  baseStamina: number;
  fastMoves: string[];
  chargedMoves: string[];
  /** Elite TM only. Phase 3 must not recommend moves outside these two lists. */
  eliteFastMoves: string[];
  eliteChargedMoves: string[];
  hasShadow: boolean;
  /** How hard this species is to obtain. Legendaries and Ultra Beasts come
   *  from raids; Mythicals are quest-gated and usually one per account. */
  rarity: Rarity;
  /** Cost of unlocking the second charged move slot. Null when it cannot be. */
  secondMoveCost: { stardust: number; candy: number } | null;
  megas: MegaForm[];
}

export interface BattleSettings {
  stab: number;
  weatherBonus: number;
  shadowAttackMultiplier: number;
  shadowDefenseMultiplier: number;
  maxEnergy: number;
  swapDurationMs: number;
  dodgeDurationMs: number;
  dodgeDamageReductionPercent: number;
  energyDeltaPerHealthLost: number;
  bossEnergyRegenerationPerHealthLost: number;
  enemyAttackIntervalS: number;
  maximumAttackersPerBattle: number;
  megaBoostSameType: number;
  megaBoostDifferentType: number;
}

export type WeatherCondition =
  | 'CLEAR' | 'RAINY' | 'PARTLY_CLOUDY' | 'OVERCAST'
  | 'WINDY' | 'SNOW' | 'FOG';

/** Stardust and candy costs to power up, indexed by whole level minus one. */
export interface UpgradeCosts {
  stardust: number[];
  candy: number[];
  xlCandy: number[];
  xlCandyMinPokemonLevel: number;
  shadowStardustMultiplier: number;
  shadowCandyMultiplier: number;
  purifiedStardustMultiplier: number;
  purifiedCandyMultiplier: number;
}

export interface GameMaster {
  source: { repo: string; commit: string; path: string; committed: string; generatedAt: string };
  types: PokemonType[];
  /** typeChart[attackingType][index of defendingType in `types`] */
  typeChart: Record<PokemonType, number[]>;
  /** Whole levels only; index = level - 1. Half levels are interpolated. */
  cpMultipliers: number[];
  settings: BattleSettings;
  /** Index = friendship level; 0 = not friends. */
  friendshipAttackMultipliers: number[];
  upgradeCosts: UpgradeCosts;
  /** Weather condition -> the move types it boosts. */
  weatherAffinities: Record<WeatherCondition, PokemonType[]>;
  moves: Record<string, Move>;
  species: Record<string, Species>;
}
