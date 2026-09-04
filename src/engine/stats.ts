import { cpm, MAX_LEVEL } from './cpm';
import { cycleDps, referenceDefender } from './moveset';
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
  /**
   * The second charged move, once unlocked. Optional because most Pokémon do
   * not have one, and because it is not something a screenshot scan can read.
   */
  chargedMove2?: string;
  isShadow?: boolean;
  /**
   * Best Buddy status. Worth +1 level, but only while this Pokémon is the
   * active buddy — see `withBuddyBoost`, which is where that rule lives.
   */
  isBestBuddy?: boolean;
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

/** A Best Buddy fights one level higher, capped at the top of the CPM table. */
export const bestBuddyLevel = (level: number) => Math.min(level + 1, MAX_LEVEL);

/**
 * The party with the Best Buddy bonus applied to at most ONE Pokémon.
 *
 * You can only have one active buddy at a time, so a party of six Best
 * Buddies does not get six boosts — a naive per-entry flag would quietly
 * inflate every such party. The boost goes to whichever of them does the most
 * damage against this boss, which is the buddy a player would actually walk in
 * with.
 *
 * The chosen entry comes back with the level already raised and the flag
 * cleared, so nothing downstream has to know the rule exists.
 */
export function withBuddyBoost(party: RosterEntry[], defenderTypes: PokemonType[]): RosterEntry[] {
  let bestIndex = -1;
  let bestDps = -Infinity;

  for (let i = 0; i < party.length; i++) {
    const entry = party[i];
    if (!entry.isBestBuddy) continue;

    const built = buildAttacker(entry);
    const dps = cycleDps(
      { attack: built.attack, types: built.types },
      referenceDefender(defenderTypes),
      entry.fastMove,
      entry.chargedMove,
    );
    if (dps > bestDps) {
      bestDps = dps;
      bestIndex = i;
    }
  }

  if (bestIndex === -1) return party;

  return party.map((entry, i) =>
    i === bestIndex
      ? { ...entry, level: bestBuddyLevel(entry.level), isBestBuddy: false }
      : { ...entry, isBestBuddy: false },
  );
}

/**
 * The same Pokémon with whichever of its charged moves is better against this
 * defender in the leading slot.
 *
 * A second charged move does not make a Pokémon hit harder in one fight — you
 * would just use the better move — it makes the same Pokémon the right answer
 * to more fights. Resolving it here is what lets every caller keep treating an
 * entry as having one charged move.
 *
 * The choice uses the closed-form cycle DPS rather than a full simulation:
 * both candidates share a Pokémon, a level and a boss, so the ranking does not
 * need the parts a simulation adds.
 */
export function withBestChargedMove(entry: RosterEntry, defenderTypes: PokemonType[]): RosterEntry {
  if (!entry.chargedMove2 || entry.chargedMove2 === entry.chargedMove) return entry;

  const built = buildAttacker(entry);
  const attacker = { attack: built.attack, types: built.types };
  const defender = referenceDefender(defenderTypes);

  const first = cycleDps(attacker, defender, entry.fastMove, entry.chargedMove);
  const second = cycleDps(attacker, defender, entry.fastMove, entry.chargedMove2);

  return second > first
    ? { ...entry, chargedMove: entry.chargedMove2, chargedMove2: entry.chargedMove }
    : entry;
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
