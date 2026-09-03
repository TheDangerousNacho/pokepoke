/**
 * Raid tier constants.
 *
 * ⚠️ STUB — NOT YET VERIFIED. These values are NOT in the Game Master dump; the
 * client holds them. The numbers below are the widely-repeated community values
 * and are almost certainly close, but nothing here has been checked against a
 * primary source yet, so no output derived from them should be presented as
 * trustworthy until `RAID_TIER_DATA_VERIFIED` flips to true.
 *
 * To verify, each field needs a source:
 *  - `bossHp`      fixed per tier, independent of lobby size (see PROJECT.md).
 *  - `bossCpm`     the multiplier applied to the boss's base defense. Raid
 *                  bosses are NOT ordinary Pokémon at a player level; they use
 *                  a tier-specific multiplier, which is why boss CP shown in
 *                  game does not match any normal level.
 *  - `timerSeconds` battle clock for the tier.
 *  - Boss IVs are 15/15/15 by convention — confirm, since it moves boss defense
 *    by a few percent.
 *
 * Cross-check candidates: Pokebattler's raid boss listings, GamePress raid
 * mechanics writeups, and the Silph Road research archive.
 */

export const RAID_TIER_DATA_VERIFIED = false;

export type RaidTier = 1 | 3 | 5 | 'MEGA' | 'MEGA_LEGENDARY' | 'ELITE';

export interface RaidTierSpec {
  tier: RaidTier;
  label: string;
  /** Fixed total HP. Does not scale with the number of trainers. */
  bossHp: number;
  /** Multiplier on the boss's base defense (and attack). */
  bossCpm: number;
  timerSeconds: number;
  /** Boss IVs, applied to base attack/defense. Stamina is ignored — HP is fixed. */
  bossIvAttack: number;
  bossIvDefense: number;
}

/** UNVERIFIED — see the module doc comment. */
export const RAID_TIERS: Record<RaidTier, RaidTierSpec> = {
  1: { tier: 1, label: 'Tier 1', bossHp: 600, bossCpm: 0.6, timerSeconds: 180, bossIvAttack: 15, bossIvDefense: 15 },
  3: { tier: 3, label: 'Tier 3', bossHp: 3600, bossCpm: 0.73, timerSeconds: 180, bossIvAttack: 15, bossIvDefense: 15 },
  5: { tier: 5, label: 'Tier 5', bossHp: 15000, bossCpm: 0.79, timerSeconds: 300, bossIvAttack: 15, bossIvDefense: 15 },
  MEGA: { tier: 'MEGA', label: 'Mega', bossHp: 15000, bossCpm: 0.79, timerSeconds: 300, bossIvAttack: 15, bossIvDefense: 15 },
  MEGA_LEGENDARY: { tier: 'MEGA_LEGENDARY', label: 'Mega Legendary', bossHp: 22500, bossCpm: 0.79, timerSeconds: 300, bossIvAttack: 15, bossIvDefense: 15 },
  ELITE: { tier: 'ELITE', label: 'Elite', bossHp: 20000, bossCpm: 0.79, timerSeconds: 300, bossIvAttack: 15, bossIvDefense: 15 },
};

export function getTier(tier: RaidTier): RaidTierSpec {
  const spec = RAID_TIERS[tier];
  if (!spec) throw new Error(`unknown raid tier: ${tier}`);
  return spec;
}
