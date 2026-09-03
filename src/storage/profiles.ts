import type { RosterEntry } from '../engine/stats';

/**
 * Roster storage. Everything lives in one localStorage key so an export is a
 * single JSON blob the user can hand to someone else.
 *
 * localStorage is per-browser-per-device: this is a permanent bank on THIS
 * device, not a synced account. Export/import is the deliberate escape hatch.
 */

const KEY = 'pokepoke.profiles.v1';
const VERSION = 2;

/**
 * A roster entry with a stable identity.
 *
 * The engine's `RosterEntry` has no id and should not need one — it is a
 * battle input, not a record. But saved parties have to refer to specific
 * Pokémon, and referring by array index breaks the moment something earlier is
 * deleted, silently changing what a party contains.
 */
export interface StoredPokemon extends RosterEntry {
  id: string;
}

export interface SavedParty {
  id: string;
  name: string;
  /** Ids into the owning profile's roster. Missing ids are ignored, not errors. */
  memberIds: string[];
}

export interface TrainerProfile {
  id: string;
  name: string;
  roster: StoredPokemon[];
  parties: SavedParty[];
}

export interface ProfileStore {
  version: number;
  activeProfileId: string;
  profiles: TrainerProfile[];
}

export const newId = (prefix = 'x') =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function emptyStore(): ProfileStore {
  const first: TrainerProfile = { id: newId('p'), name: 'Me', roster: [], parties: [] };
  return { version: VERSION, activeProfileId: first.id, profiles: [first] };
}

/**
 * Narrows an unknown blob to a store, discarding anything malformed and
 * filling in what older versions did not have.
 *
 * Written to be forgiving rather than strict: this parses data the user has
 * accumulated over time, and losing a roster to a schema quibble would be far
 * worse than carrying a slightly odd record.
 */
function parseStore(raw: unknown): ProfileStore | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Partial<ProfileStore>;
  if (!Array.isArray(s.profiles) || s.profiles.length === 0) return null;

  const profiles: TrainerProfile[] = [];
  for (const p of s.profiles) {
    if (typeof p?.id !== 'string' || typeof p?.name !== 'string' || !Array.isArray(p?.roster)) continue;

    // v1 rosters have no per-Pokémon ids; mint them on first read.
    const roster: StoredPokemon[] = p.roster
      .filter((e: unknown): e is Partial<StoredPokemon> & RosterEntry =>
        typeof (e as RosterEntry)?.speciesId === 'string')
      .map((e) => ({ ...e, id: typeof e.id === 'string' ? e.id : newId('m') }));

    const known = new Set(roster.map((e) => e.id));
    const parties: SavedParty[] = (Array.isArray(p.parties) ? p.parties : [])
      .filter((q): q is SavedParty => typeof q?.id === 'string' && typeof q?.name === 'string' && Array.isArray(q?.memberIds))
      // Drop references to Pokémon that no longer exist rather than rendering
      // a party that silently has fewer members than it claims.
      .map((q) => ({ ...q, memberIds: q.memberIds.filter((id) => known.has(id)) }));

    profiles.push({ id: p.id, name: p.name, roster, parties });
  }
  if (profiles.length === 0) return null;

  const activeProfileId = profiles.some((p) => p.id === s.activeProfileId)
    ? (s.activeProfileId as string)
    : profiles[0].id;

  return { version: VERSION, activeProfileId, profiles };
}

export function loadStore(): ProfileStore {
  // Every access is guarded: private windows and blocked site data throw here.
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    return parseStore(JSON.parse(raw)) ?? emptyStore();
  } catch {
    return emptyStore();
  }
}

export function saveStore(store: ProfileStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable or full. The app keeps working for this session.
  }
}

export function exportStore(store: ProfileStore): string {
  return JSON.stringify(store, null, 2);
}

/** Throws with a readable message so the UI can show why an import failed. */
export function importStore(text: string): ProfileStore {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const store = parseStore(raw);
  if (!store) throw new Error("That file doesn't look like a PokePoke export.");
  return store;
}

export function addProfile(store: ProfileStore, name: string): ProfileStore {
  const profile: TrainerProfile = { id: newId('p'), name: name.trim() || 'Trainer', roster: [], parties: [] };
  return { ...store, profiles: [...store.profiles, profile], activeProfileId: profile.id };
}

export function removeProfile(store: ProfileStore, id: string): ProfileStore {
  const profiles = store.profiles.filter((p) => p.id !== id);
  if (profiles.length === 0) return emptyStore();
  return {
    ...store,
    profiles,
    activeProfileId: store.activeProfileId === id ? profiles[0].id : store.activeProfileId,
  };
}

function updateProfile(
  store: ProfileStore,
  id: string,
  change: (p: TrainerProfile) => TrainerProfile,
): ProfileStore {
  return { ...store, profiles: store.profiles.map((p) => (p.id === id ? change(p) : p)) };
}

export function updateRoster(store: ProfileStore, id: string, roster: StoredPokemon[]): ProfileStore {
  return updateProfile(store, id, (p) => {
    const known = new Set(roster.map((e) => e.id));
    return {
      ...p,
      roster,
      // A deleted Pokémon must leave the parties it was in, or a party would
      // quietly fight with five.
      parties: p.parties.map((q) => ({ ...q, memberIds: q.memberIds.filter((m) => known.has(m)) })),
    };
  });
}

export function renameProfile(store: ProfileStore, id: string, name: string): ProfileStore {
  return updateProfile(store, id, (p) => ({ ...p, name: name.trim() || p.name }));
}

export function saveParty(
  store: ProfileStore,
  profileId: string,
  party: Omit<SavedParty, 'id'> & { id?: string },
): ProfileStore {
  return updateProfile(store, profileId, (p) => {
    const id = party.id ?? newId('t');
    const next: SavedParty = { id, name: party.name.trim() || 'Party', memberIds: party.memberIds };
    return p.parties.some((q) => q.id === id)
      ? { ...p, parties: p.parties.map((q) => (q.id === id ? next : q)) }
      : { ...p, parties: [...p.parties, next] };
  });
}

export function removeParty(store: ProfileStore, profileId: string, partyId: string): ProfileStore {
  return updateProfile(store, profileId, (p) => ({
    ...p,
    parties: p.parties.filter((q) => q.id !== partyId),
  }));
}

export function activeProfile(store: ProfileStore): TrainerProfile {
  return store.profiles.find((p) => p.id === store.activeProfileId) ?? store.profiles[0];
}

/** Resolves a saved party to actual Pokémon, in roster order. */
export function partyMembers(profile: TrainerProfile, partyId: string): StoredPokemon[] {
  const party = profile.parties.find((q) => q.id === partyId);
  if (!party) return [];
  const ids = new Set(party.memberIds);
  return profile.roster.filter((e) => ids.has(e.id));
}
