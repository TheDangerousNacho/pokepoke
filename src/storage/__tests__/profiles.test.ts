import { describe, expect, it } from 'vitest';
import {
  addProfile, applyImport, emptyStore, exportStore, importStore, partyMembers,
  previewImport, removeParty, removeProfile, renameProfile, saveParty,
  updateRoster, type StoredPokemon,
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

describe('non-destructive import', () => {
  const other = () => {
    let s = emptyStore();
    s = renameProfile(s, s.activeProfileId, 'Kid A');
    return updateRoster(s, s.activeProfileId, [mon('k1', 'MACHOKE')]);
  };

  it('never applies anything from a preview alone', () => {
    const mine = seeded();
    const before = JSON.stringify(mine);
    previewImport(exportStore(other()), mine);
    expect(JSON.stringify(mine)).toBe(before);
  });

  it('adds an unrecognised profile instead of replacing everything', () => {
    // The bug this replaces: importing a friend's file wiped your own roster.
    const mine = seeded();
    const preview = previewImport(exportStore(other()), mine);
    const merged = applyImport(mine, preview, { [preview.candidates[0].profile.id]: 'add' });

    expect(merged.profiles).toHaveLength(2);
    expect(merged.profiles[0].roster).toHaveLength(3); // mine, untouched
    expect(merged.profiles[1].name).toBe('Kid A');
  });

  it('defaults to adding what it does not recognise', () => {
    const preview = previewImport(exportStore(other()), seeded());
    expect(preview.candidates[0].suggested).toBe('add');
    expect(preview.candidates[0].existing).toBeNull();
  });

  it('updates in place when the same trainer comes back', () => {
    const mine = seeded();
    let theirCopy = mine;
    theirCopy = updateRoster(theirCopy, theirCopy.activeProfileId, [
      ...theirCopy.profiles[0].roster, mon('m4', 'GYARADOS'),
    ]);

    const preview = previewImport(exportStore(theirCopy), mine);
    expect(preview.candidates[0].suggested).toBe('replace');

    const merged = applyImport(mine, preview, { [preview.candidates[0].profile.id]: 'replace' });
    expect(merged.profiles).toHaveLength(1);
    expect(merged.profiles[0].roster).toHaveLength(4);
  });

  it('skips what the user declines', () => {
    const mine = seeded();
    const preview = previewImport(exportStore(other()), mine);
    const merged = applyImport(mine, preview, { [preview.candidates[0].profile.id]: 'skip' });
    expect(merged.profiles).toHaveLength(1);
    expect(merged).toEqual(mine);
  });

  it('treats an unlisted profile as skip rather than guessing', () => {
    const mine = seeded();
    const preview = previewImport(exportStore(other()), mine);
    expect(applyImport(mine, preview, {})).toEqual(mine);
  });

  it('does not collide ids when adding a profile that is already here', () => {
    const mine = seeded();
    const preview = previewImport(exportStore(mine), mine);
    const merged = applyImport(mine, preview, { [preview.candidates[0].profile.id]: 'add' });

    expect(merged.profiles).toHaveLength(2);
    expect(new Set(merged.profiles.map((p) => p.id)).size).toBe(2);
    expect(merged.profiles[1].name).toMatch(/imported/);
  });

  it('keeps the active profile pointing at something real', () => {
    const mine = seeded();
    const preview = previewImport(exportStore(other()), mine);
    const merged = applyImport(mine, preview, { [preview.candidates[0].profile.id]: 'add' });
    expect(merged.profiles.some((p) => p.id === merged.activeProfileId)).toBe(true);
  });

  it('reports when the file was exported', () => {
    const preview = previewImport(exportStore(seeded()), emptyStore());
    expect(preview.exportedAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(preview.exportedAt!))).toBe(false);
  });

  it('survives a file with no export date', () => {
    const bare = JSON.stringify({ version: 2, activeProfileId: 'p1', profiles: [
      { id: 'p1', name: 'Old', roster: [mon('m1', 'MACHAMP')], parties: [] },
    ] });
    expect(previewImport(bare, emptyStore()).exportedAt).toBeNull();
  });

  it('still round-trips exactly, export date and all', () => {
    const store = seeded();
    expect(importStore(exportStore(store))).toEqual(store);
  });
});
