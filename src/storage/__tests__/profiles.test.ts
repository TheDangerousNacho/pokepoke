import { describe, expect, it } from 'vitest';
import {
  addProfile, emptyStore, exportStore, importStore, partyMembers, removeParty,
  removeProfile, renameProfile, saveParty, updateRoster, type StoredPokemon,
} from '../profiles';

const mon = (id: string, speciesId: string): StoredPokemon => ({
  id,
  speciesId,
  level: 40,
  ivs: { attack: 15, defense: 15, stamina: 15 },
  fastMove: 'COUNTER_FAST',
  chargedMove: 'DYNAMIC_PUNCH',
});

const seeded = () => {
  const store = emptyStore();
  return updateRoster(store, store.activeProfileId, [
    mon('m1', 'MACHAMP'), mon('m2', 'METAGROSS'), mon('m3', 'TYRANITAR'),
  ]);
};

describe('migration from v1', () => {
  it('mints ids for rosters saved before parties existed', () => {
    const v1 = {
      version: 1,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1',
        name: 'Me',
        roster: [{
          speciesId: 'MACHAMP', level: 40,
          ivs: { attack: 15, defense: 15, stamina: 15 },
          fastMove: 'COUNTER_FAST', chargedMove: 'DYNAMIC_PUNCH',
        }],
      }],
    };
    const store = importStore(JSON.stringify(v1));
    expect(store.profiles[0].roster).toHaveLength(1);
    expect(typeof store.profiles[0].roster[0].id).toBe('string');
    expect(store.profiles[0].parties).toEqual([]);
    expect(store.profiles[0].roster[0].speciesId).toBe('MACHAMP');
  });

  it('keeps ids that are already there', () => {
    const round = importStore(exportStore(seeded()));
    expect(round.profiles[0].roster.map((e) => e.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('never loses a roster to a malformed party list', () => {
    const broken = {
      version: 2,
      activeProfileId: 'p1',
      profiles: [{ id: 'p1', name: 'Me', roster: [mon('m1', 'MACHAMP')], parties: 'nonsense' }],
    };
    const store = importStore(JSON.stringify(broken));
    expect(store.profiles[0].roster).toHaveLength(1);
    expect(store.profiles[0].parties).toEqual([]);
  });
});

describe('saved parties', () => {
  it('saves and resolves members in roster order', () => {
    let store = seeded();
    store = saveParty(store, store.activeProfileId, { name: 'Fighters', memberIds: ['m3', 'm1'] });
    const party = store.profiles[0].parties[0];
    expect(party.name).toBe('Fighters');
    expect(partyMembers(store.profiles[0], party.id).map((e) => e.speciesId))
      .toEqual(['MACHAMP', 'TYRANITAR']);
  });

  it('updates a party in place when given its id', () => {
    let store = seeded();
    const pid = store.activeProfileId;
    store = saveParty(store, pid, { name: 'A', memberIds: ['m1'] });
    const id = store.profiles[0].parties[0].id;
    store = saveParty(store, pid, { id, name: 'B', memberIds: ['m1', 'm2'] });
    expect(store.profiles[0].parties).toHaveLength(1);
    expect(store.profiles[0].parties[0].name).toBe('B');
  });

  it('drops a Pokémon from every party when it leaves the roster', () => {
    // Otherwise a party silently fights with five.
    let store = seeded();
    const pid = store.activeProfileId;
    store = saveParty(store, pid, { name: 'All', memberIds: ['m1', 'm2', 'm3'] });
    store = updateRoster(store, pid, store.profiles[0].roster.filter((e) => e.id !== 'm2'));
    expect(store.profiles[0].parties[0].memberIds).toEqual(['m1', 'm3']);
  });

  it('ignores references to Pokémon that no longer exist on load', () => {
    const store = importStore(JSON.stringify({
      version: 2,
      activeProfileId: 'p1',
      profiles: [{
        id: 'p1', name: 'Me', roster: [mon('m1', 'MACHAMP')],
        parties: [{ id: 't1', name: 'Ghosts', memberIds: ['m1', 'gone'] }],
      }],
    }));
    expect(store.profiles[0].parties[0].memberIds).toEqual(['m1']);
  });

  it('deletes a party without touching the roster', () => {
    let store = seeded();
    const pid = store.activeProfileId;
    store = saveParty(store, pid, { name: 'A', memberIds: ['m1'] });
    store = removeParty(store, pid, store.profiles[0].parties[0].id);
    expect(store.profiles[0].parties).toEqual([]);
    expect(store.profiles[0].roster).toHaveLength(3);
  });

  it('keeps parties separate per profile', () => {
    let store = seeded();
    store = saveParty(store, store.activeProfileId, { name: 'Mine', memberIds: ['m1'] });
    store = addProfile(store, 'Someone else');
    expect(store.profiles[1].parties).toEqual([]);
    expect(store.profiles[0].parties).toHaveLength(1);
  });
});

describe('profiles', () => {
  it('round-trips through export and import', () => {
    let store = seeded();
    store = saveParty(store, store.activeProfileId, { name: 'Fighters', memberIds: ['m1'] });
    expect(importStore(exportStore(store))).toEqual(store);
  });

  it('rejects a file that is not an export', () => {
    expect(() => importStore('not json')).toThrow(/valid JSON/);
    expect(() => importStore('{"hello":1}')).toThrow(/PokePoke export/);
  });

  it('never leaves you with zero profiles', () => {
    const store = emptyStore();
    expect(removeProfile(store, store.activeProfileId).profiles).toHaveLength(1);
  });

  it('renames without disturbing the roster', () => {
    const store = renameProfile(seeded(), 'nope', 'X');
    expect(store.profiles[0].roster).toHaveLength(3);
  });
});
