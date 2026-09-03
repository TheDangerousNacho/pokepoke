import { cpm } from './cpm';
import { gm, getSpecies } from './gamemaster';
import { BOSS_IV_ATTACK, BOSS_IV_DEFENSE, getTier, type RaidTier } from './raidTiers';
import type { PokemonType, Species } from './types';

export interface IVs {
  attack: number;
  defense: number;
  stamina: number;
}

/** A Pokémon the user owns, as entered or scanned. */
export interface RosterEntry {
  /** Key into the Game Master species table. */
  speciesId: string;
  level: number;
  ivs: IVs;
  fastMove: string;
  chargedMove: string;
  isShadow?: boolean;
  /** Mega form id (e.g. `TEMP_EVOLUTION_MEGA_X`) when this Pokémon is megaed. */
  megaId?: string;
}

/** Everything the battle sim needs about one side of a matchup. */
export interface Combatant {
  name: string;
  types: PokemonType[];
  attack: number;
  defense: number;
  hp: number;
  fastMove: string;
  chargedMove: string;
  isShadow: boolean;
}

/** Base stats and types after applying a mega evolution, if any. */
function resolveForm(species: Species, megaId?: string) {
  if (!megaId) return species;
  const mega = species.megas.find((m) => m.id === megaId);
  if (!mega) throw new Error(`${species.id} has no mega form ${megaId}`);
  return { ...species, types: mega.types, baseAttack: mega.baseAttack, baseDefense: mega.baseDefense, baseStamina: mega.baseStamina };
}

/**
 * Builds the attacker side. Shadow multipliers are folded into the stats here
 * rather than into the damage formula: a shadow hits 1.2x harder *and* takes
 * more damage, and both follow from its stats.
 */
export function buildAttacker(entry: RosterEntry): Combatant {
  const base = resolveForm(getSpecies(entry.speciesId), entry.megaId);
  const m = cpm(entry.level);
  const shadow = entry.isShadow ?? false;

  return {
    name: entry.megaId ? `${base.id} (${entry.megaId.replace('TEMP_EVOLUTION_', '')})` : base.id,
    types: base.types,
    attack: (base.baseAttack + entry.ivs.attack) * m * (shadow ? gm.settings.shadowAttackMultiplier : 1),
    defense: (base.baseDefense + entry.ivs.defense) * m * (shadow ? gm.settings.shadowDefenseMultiplier : 1),
    hp: Math.floor((base.baseStamina + entry.ivs.stamina) * m),
    fastMove: entry.fastMove,
    chargedMove: entry.chargedMove,
    isShadow: shadow,
  };
}

/** A raid boss in the current rotation. */
export interface RaidBossSpec {
  speciesId: string;
  tier: RaidTier;
  fastMove: string;
  chargedMove: string;
  /** Set for mega raid bosses; uses the mega's stat line and types. */
  megaId?: string;
}

/**
 * Builds the boss side. Boss HP is the tier's fixed value, not a stat
 * computation — that is the whole reason solo/duo/trio is a simple division.
 */
export function buildBoss(spec: RaidBossSpec): Combatant {
  const species = resolveForm(getSpecies(spec.speciesId), spec.megaId);
  const t = getTier(spec.tier);

  // Shadow raid bosses are not given the usual shadow attack/defense
  // multipliers here: Pokebattler encodes that difficulty in the tier's own
  // higher bossCpm (0.82 for shadow tier 5 vs 0.79), so applying both would
  // double-count it.
  return {
    name: species.id,
    types: species.types,
    attack: (species.baseAttack + BOSS_IV_ATTACK) * t.bossCpm,
    defense: (species.baseDefense + BOSS_IV_DEFENSE) * t.bossCpm,
    hp: t.bossHp,
    fastMove: spec.fastMove,
    chargedMove: spec.chargedMove,
    isShadow: false,
  };
}
