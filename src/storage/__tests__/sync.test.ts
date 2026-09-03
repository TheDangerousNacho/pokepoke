import { describe, expect, it } from 'vitest';
import { syncStore, type RemoteIndexEntry } from '../sync';
import type { ProfileStore, TrainerProfile } from '../profiles';

const profile = (id: string, name: string, updatedAt: string, pokemon = 1): TrainerProfile => ({
  id, name, updatedAt, parties: [],
  roster: Array.from({ length: pokemon }, (_, i) => ({
    id: `${id}-m${i}`, speciesId: 'MACHAMP', level: 40,
    ivs: { attack: 15, defense: 15, stamina: 15 },
    fastMove: 'COUNTER_FAST', chargedMove: 'DYNAMIC_PUNCH',
  })),
});

const storeOf = (...profiles: TrainerProfile[]): ProfileStore => ({
  version: 3, activeProfileId: profiles[0]?.id ?? 'none', profiles,
});

/** A fake server: an id -> profile map, recording what was written. */
function server(initial: TrainerProfile[] = []) {
  const data = new Map(initial.map((p) => [p.id, p]));
  const puts: string[] = [];
  return {
    data,
    puts,
    fetchers: {
      index: async (): Promise<RemoteIndexEntry[]> =>
        [...data.values()].map((p) => ({ id: p.id, updatedAt: p.updatedAt, name: p.name })),
      get: async (id: string) => data.get(id)!,
      put: async (p: TrainerProfile) => { data.set(p.id, p); puts.push(p.id); },
    },
  };
}

const OLD = '2026-09-01T00:00:00.000Z';
const NEW = '2026-09-05T00:00:00.000Z';

describe('syncStore', () => {
  it('pushes a profile the server has never seen', async () => {
    const s = server();
    const { result } = await syncStore(storeOf(profile('p1', 'Will', OLD)), s.fetchers);
    expect(result.pushed).toEqual(['Will']);
    expect(s.data.has('p1')).toBe(true);
  });

  it('pulls a profile this device has never seen', async () => {
    const s = server([profile('p2', 'Kid A', OLD)]);
    const { store, result } = await syncStore(storeOf(profile('p1', 'Will', OLD)), s.fetchers);
    expect(result.pulled).toEqual(['Kid A']);
    expect(store.profiles.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('does nothing when both sides match', async () => {
    const p = profile('p1', 'Will', OLD);
    const s = server([p]);
    const { result } = await syncStore(storeOf(p), s.fetchers);
    expect(result.pushed).toEqual([]);
    expect(result.pulled).toEqual([]);
    expect(result.unchanged).toBe(1);
  });

  it('pushes when the local copy is newer', async () => {
    const s = server([profile('p1', 'Will', OLD, 1)]);
    const { result } = await syncStore(storeOf(profile('p1', 'Will', NEW, 5)), s.fetchers);
    expect(result.pushed).toEqual(['Will']);
    expect(result.pulled).toEqual([]);
    expect(s.data.get('p1')!.roster).toHaveLength(5);
  });

  it('pulls when the remote copy is newer, replacing in place', async () => {
    const s = server([profile('p1', 'Will', NEW, 7)]);
    const { store, result } = await syncStore(storeOf(profile('p1', 'Will', OLD, 1)), s.fetchers);
    expect(result.pulled).toEqual(['Will']);
    expect(store.profiles).toHaveLength(1);
    expect(store.profiles[0].roster).toHaveLength(7);
  });

  it('never both pushes and pulls the same profile', async () => {
    // Doing both would mean one direction silently undoing the other.
    const s = server([profile('p1', 'Will', NEW, 7)]);
    const { result } = await syncStore(storeOf(profile('p1', 'Will', OLD, 1)), s.fetchers);
    expect(result.pushed).not.toContain('Will');
  });

  it('leaves other people alone while syncing your own edits', async () => {
    // The reason sync is per profile: editing your roster must not touch
    // anyone else's, even if theirs is older here.
    const s = server([profile('p1', 'Will', OLD, 1), profile('p2', 'Kid A', NEW, 9)]);
    const local = storeOf(profile('p1', 'Will', NEW, 4), profile('p2', 'Kid A', OLD, 1));
    const { store, result } = await syncStore(local, s.fetchers);

    expect(result.pushed).toEqual(['Will']);
    expect(result.pulled).toEqual(['Kid A']);
    expect(s.data.get('p1')!.roster).toHaveLength(4);
    expect(store.profiles.find((p) => p.id === 'p2')!.roster).toHaveLength(9);
  });

  it('keeps the active profile pointing at something real', async () => {
    const s = server([profile('p9', 'Someone', NEW)]);
    const { store } = await syncStore(storeOf(profile('p1', 'Will', OLD)), s.fetchers);
    expect(store.profiles.some((p) => p.id === store.activeProfileId)).toBe(true);
  });

  it('treats a missing remote timestamp as older than any local one', async () => {
    const s = server();
    s.data.set('p1', { ...profile('p1', 'Will', OLD), updatedAt: undefined as never });
    const { result } = await syncStore(storeOf(profile('p1', 'Will', OLD)), s.fetchers);
    expect(result.pushed).toEqual(['Will']);
  });

  it('is idempotent — a second sync moves nothing', async () => {
    const s = server([profile('p2', 'Kid A', NEW)]);
    const first = await syncStore(storeOf(profile('p1', 'Will', OLD)), s.fetchers);
    const second = await syncStore(first.store, s.fetchers);
    expect(second.result.pushed).toEqual([]);
    expect(second.result.pulled).toEqual([]);
  });
});
