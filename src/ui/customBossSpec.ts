import { getSpecies } from '../engine/gamemaster';
import type { RaidTier } from '../engine/raidTiers';
import type { BossListEntry } from './BossPicker';

/** Tiers whose boss fights a mega form rather than the base species. */
export const MEGA_TIERS: RaidTier[] = ['MEGA', 'MEGA_LEGENDARY'];

/**
 * Builds a boss the rotation feed doesn't list.
 *
 * The moveset defaults to the species' first listed pair, matching how
 * `fetch-bosses.mjs` defaults the rotation, and excludes Elite moves — a boss
 * with a legacy moveset is the exception, and guessing one would overstate how
 * fast your team faints. Returns null for the handful of forms with no usable
 * moves, which cannot be simulated at all.
 */
export function buildCustomBoss(
  speciesId: string,
  tier: RaidTier,
  megaId?: string,
): BossListEntry | null {
  const species = getSpecies(speciesId);
  if (species.fastMoves.length === 0 || species.chargedMoves.length === 0) return null;

  return {
    speciesId,
    tier,
    fastMove: species.fastMoves[0],
    chargedMove: species.chargedMoves[0],
    megaId: megaId ?? (MEGA_TIERS.includes(tier) ? species.megas[0]?.id : undefined),
    custom: true,
  };
}
