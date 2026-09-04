import bundled from '../data/bosses.json' with { type: 'json' };
import { fetchRotation, type RotationBoss } from '../data/rotation';
import { gm } from '../engine/gamemaster';
import type { RaidTier } from '../engine/raidTiers';

const KEY = 'pokepoke.rotation.v1';

/**
 * The bit of `localStorage` this module uses. Injectable so the behaviour that
 * matters — preferring the newer list, surviving a corrupt one — can be tested
 * without pulling in a DOM.
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Absent in a worker or a test without a DOM; every read is guarded anyway. */
const defaultStorage = (): StorageLike | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage;

export interface Rotation {
  fetchedAt: string;
  bosses: RotationBoss[];
  /** True when this came from the app refreshing, not from the build. */
  refreshed: boolean;
}

const BUNDLED: Rotation = {
  fetchedAt: bundled.fetchedAt,
  bosses: (bundled.bosses as Array<RotationBoss & { tier: string }>).map((b) => ({
    ...b,
    tier: b.tier as RaidTier,
  })),
  refreshed: false,
};

/**
 * The rotation to show: whatever the app last fetched, else the one shipped
 * with the build.
 *
 * A stored rotation is only preferred when it is *newer* than the bundled one,
 * so shipping a fresh build is never undone by a stale refresh sitting in a
 * phone's localStorage.
 */
export function loadRotation(storage = defaultStorage()): Rotation {
  try {
    const raw = storage?.getItem(KEY) ?? null;
    if (!raw) return BUNDLED;

    const stored = JSON.parse(raw) as Rotation;
    if (!Array.isArray(stored.bosses) || stored.bosses.length === 0) return BUNDLED;
    if (Date.parse(stored.fetchedAt) <= Date.parse(BUNDLED.fetchedAt)) return BUNDLED;

    return { ...stored, refreshed: true };
  } catch {
    // A corrupt or unreadable store must never take the boss list with it.
    return BUNDLED;
  }
}

/** Fetches the live rotation and stores it. Returns what will now be shown. */
export async function refreshRotation(
  fetchImpl: typeof fetch = fetch,
  storage = defaultStorage(),
): Promise<Rotation> {
  const { bosses, skipped } = await fetchRotation(gm.species, fetchImpl);
  if (bosses.length === 0) throw new Error('The rotation feed came back empty.');

  const rotation: Rotation = { fetchedAt: new Date().toISOString(), bosses, refreshed: true };
  try {
    storage?.setItem(KEY, JSON.stringify({ fetchedAt: rotation.fetchedAt, bosses }));
  } catch {
    // Out of quota or private mode: the fetch still worked, so show it for
    // this session rather than failing the whole refresh.
  }
  if (skipped.length > 0) console.warn(`rotation: skipped ${skipped.join(', ')}`);
  return rotation;
}

/** Drops the stored rotation, falling back to the one shipped with the build. */
export function resetRotation(storage = defaultStorage()): Rotation {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* nothing stored is the desired state anyway */
  }
  return BUNDLED;
}
