import type { RaidTier } from '../engine/raidTiers';
import type { RaidBossSpec } from '../engine/stats';

/**
 * Pokebattler's live raid list. Served with `access-control-allow-origin: *`,
 * which is what lets the app refresh itself rather than only the build script.
 */
export const ROTATION_SOURCE = 'https://fight.pokebattler.com/raids';

export interface RotationBoss extends RaidBossSpec {
  shiny: boolean;
}

export interface RotationResult {
  bosses: RotationBoss[];
  /** Feed entries with no Game Master match, kept so a miss is visible. */
  skipped: string[];
}

/**
 * Pokebattler tier id -> our tier key. Anything not listed is dropped, which
 * removes their _LEGACY / _FUTURE duplicates and the Dynamax tiers.
 */
const TIER_MAP: Record<string, RaidTier> = {
  RAID_LEVEL_1: '1',
  RAID_LEVEL_3: '3',
  RAID_LEVEL_4: '4',
  RAID_LEVEL_5: '5',
  RAID_LEVEL_6: '6',
  RAID_LEVEL_MEGA: 'MEGA',
  RAID_LEVEL_MEGA_5: 'MEGA_LEGENDARY',
  RAID_LEVEL_ELITE: 'ELITE',
  RAID_LEVEL_3_SHADOW: 'SHADOW_3',
  RAID_LEVEL_5_SHADOW: 'SHADOW_5',
};

/**
 * Pokebattler names forms differently from the Game Master: `_MEGA` suffixes
 * instead of a temp-evolution on the base species, `_SHADOW_FORM` instead of a
 * flag, and `_FORM` tacked onto regional names. Normalise to our keys.
 */
function normalise(pokebattlerId: string): { speciesId: string; megaId?: string } {
  for (const [suffix, megaId] of [
    ['_MEGA_X', 'TEMP_EVOLUTION_MEGA_X'],
    ['_MEGA_Y', 'TEMP_EVOLUTION_MEGA_Y'],
    ['_MEGA', 'TEMP_EVOLUTION_MEGA'],
  ] as const) {
    if (pokebattlerId.endsWith(suffix)) {
      return { speciesId: pokebattlerId.slice(0, -suffix.length), megaId };
    }
  }
  // Shadow is already implied by the SHADOW_* tier; the species is the base.
  for (const suffix of ['_SHADOW_FORM', '_FORM']) {
    if (pokebattlerId.endsWith(suffix)) return { speciesId: pokebattlerId.slice(0, -suffix.length) };
  }
  return { speciesId: pokebattlerId };
}

/** What the parser needs to know about a species, so callers can pass either
 *  the unpacked Game Master or a stub. */
export interface RotationSpecies {
  fastMoves: string[];
  chargedMoves: string[];
  megas: Array<{ id: string }>;
}

interface RotationFeed {
  tiers?: Array<{ tier?: string; raids?: Array<{ pokemon?: string; shiny?: boolean }> }>;
}

/**
 * Turns the live feed into raid bosses we can simulate.
 *
 * Movesets are not part of the feed, so each boss defaults to the species'
 * first listed pair — the same default the custom boss builder uses — and the
 * Boss tab lets it be changed.
 */
export function parseRotation(
  feed: unknown,
  species: Record<string, RotationSpecies>,
): RotationResult {
  const { tiers } = (feed ?? {}) as RotationFeed;
  if (!Array.isArray(tiers)) throw new Error('rotation feed has no tiers');

  const bosses: RotationBoss[] = [];
  const skipped: string[] = [];

  for (const t of tiers) {
    const tier = t.tier ? TIER_MAP[t.tier] : undefined;
    if (!tier) continue;

    for (const raid of t.raids ?? []) {
      if (!raid.pokemon) continue;
      const { speciesId, megaId } = normalise(raid.pokemon);
      const found = species[speciesId];

      if (!found || (megaId && !found.megas.some((m) => m.id === megaId))) {
        skipped.push(`${raid.pokemon} (${t.tier})`);
        continue;
      }
      if (found.fastMoves.length === 0 || found.chargedMoves.length === 0) {
        skipped.push(`${raid.pokemon} (no moves)`);
        continue;
      }
      if (bosses.some((b) => b.speciesId === speciesId && b.megaId === megaId && b.tier === tier)) {
        continue;
      }

      bosses.push({
        speciesId,
        ...(megaId ? { megaId } : {}),
        tier,
        shiny: Boolean(raid.shiny),
        fastMove: found.fastMoves[0],
        chargedMove: found.chargedMoves[0],
      });
    }
  }

  bosses.sort((a, b) => a.tier.localeCompare(b.tier) || a.speciesId.localeCompare(b.speciesId));
  return { bosses, skipped };
}

/** Fetches and parses the live rotation. Throws with a readable message. */
export async function fetchRotation(
  species: Record<string, RotationSpecies>,
  fetchImpl: typeof fetch = fetch,
): Promise<RotationResult> {
  const res = await fetchImpl(ROTATION_SOURCE);
  if (!res.ok) throw new Error(`Rotation fetch failed (${res.status}).`);
  return parseRotation(await res.json(), species);
}
