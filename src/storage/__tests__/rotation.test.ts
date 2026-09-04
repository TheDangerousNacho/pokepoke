import { beforeEach, describe, expect, it } from 'vitest';
import bundled from '../../data/bosses.json' with { type: 'json' };
import { loadRotation, refreshRotation, resetRotation, type StorageLike } from '../rotation';

const KEY = 'pokepoke.rotation.v1';

let memory: Map<string, string>;
const storage: StorageLike = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

const store = (fetchedAt: string, bosses: unknown[]) =>
  storage.setItem(KEY, JSON.stringify({ fetchedAt, bosses }));

describe('the stored rotation', () => {
  beforeEach(() => { memory = new Map(); });

  it('falls back to the bundled list when nothing is stored', () => {
    const r = loadRotation(storage);
    expect(r.refreshed).toBe(false);
    expect(r.bosses.length).toBe(bundled.bosses.length);
  });

  it('prefers a stored rotation only when it is newer than the build', () => {
    const boss = { speciesId: 'MEWTWO', tier: '5', fastMove: 'CONFUSION_FAST', chargedMove: 'PSYCHIC', shiny: false };

    store('2000-01-01T00:00:00.000Z', [boss]);
    expect(loadRotation(storage).refreshed).toBe(false);

    store('2999-01-01T00:00:00.000Z', [boss]);
    const fresh = loadRotation(storage);
    expect(fresh.refreshed).toBe(true);
    expect(fresh.bosses[0].speciesId).toBe('MEWTWO');
  });

  it('ignores a corrupt or empty store rather than losing the boss list', () => {
    storage.setItem(KEY, 'not json');
    expect(loadRotation(storage).bosses.length).toBe(bundled.bosses.length);

    store('2999-01-01T00:00:00.000Z', []);
    expect(loadRotation(storage).bosses.length).toBe(bundled.bosses.length);
  });

  it('refuses to store an empty rotation', async () => {
    const empty = (async () => new Response(JSON.stringify({ tiers: [] }))) as unknown as typeof fetch;
    await expect(refreshRotation(empty, storage)).rejects.toThrow(/empty/);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it('stores what it fetched, and reset goes back to the build', async () => {
    const feed = { tiers: [{ tier: 'RAID_LEVEL_5', raids: [{ pokemon: 'REGIROCK' }] }] };
    const ok = (async () => new Response(JSON.stringify(feed))) as unknown as typeof fetch;

    const refreshed = await refreshRotation(ok, storage);
    expect(refreshed.refreshed).toBe(true);
    expect(refreshed.bosses).toHaveLength(1);
    expect(loadRotation(storage).bosses).toHaveLength(1);

    expect(resetRotation(storage).refreshed).toBe(false);
    expect(storage.getItem(KEY)).toBeNull();
  });
});
