/**
 * Raid tier constants: boss HP, the multiplier applied to the boss's base
 * stats, and the battle timer.
 *
 * These are NOT in the PokeMiners Game Master dump — the client holds them.
 * Sourced from Pokebattler's public raid endpoint (`fight.pokebattler.com/raids`,
 * fetched 2026-09-02), which exposes `hp`, `cpm` and `combatTimeMs` per tier.
 * Refresh with `npm run fetch:tiers`.
 *
 * Two things worth knowing about this table:
 *
 *  - Boss HP is FIXED per tier and does not scale with lobby size. Extra
 *    trainers add damage; they do not add boss HP. This is why solo/duo/trio
 *    is a division rather than a scaling curve.
 *  - `bossCpm` is not a player-level CPM. Tier 4 uses 1.0 and Elite uses 0.985,
 *    neither of which any Pokémon level produces. The `nominalLevel` field is
 *    the level the game *displays* for the tier and is informational only —
 *    never feed it to `cpm()`.
 */

import tiers from '../data/raidTiers.json';

/** True once the table has been fetched from a real source rather than guessed. */
export const RAID_TIER_DATA_VERIFIED = true;

export type RaidTier = '1' | '3' | '4' | '5' | '6' | 'MEGA' | 'MEGA_LEGENDARY' | 'ELITE' | 'SHADOW_3' | 'SHADOW_5';

export interface RaidTierSpec {
  /** Pokebattler's identifier for this tier, kept so the table can be re-fetched. */
  pokebattlerTier: string;
  label: string;
  /** Fixed total HP. Independent of the number of trainers. */
  bossHp: number;
  /** Multiplier on the boss's base attack and defense. Not a player-level CPM. */
  bossCpm: number;
  timerSeconds: number;
  /** Whether Pokebattler considers the tier soloable at all. Informational. */
  soloable: boolean;
  /** The level the game displays for this tier. Informational — not a CPM input. */
  nominalLevel: string;
}

export const RAID_TIERS = tiers as Record<RaidTier, RaidTierSpec>;

/**
 * Raid bosses are assumed to have 15/15 attack/defense IVs. Widely accepted,
 * and it is what Pokebattler's numbers are built on; worth revisiting if our
 * simulated damage drifts from theirs by a consistent few percent.
 */
export const BOSS_IV_ATTACK = 15;
export const BOSS_IV_DEFENSE = 15;

export function getTier(tier: RaidTier): RaidTierSpec {
  const spec = RAID_TIERS[tier];
  if (!spec) throw new Error(`unknown raid tier: ${tier}`);
  return spec;
}

export const ALL_TIERS = Object.keys(RAID_TIERS) as RaidTier[];
