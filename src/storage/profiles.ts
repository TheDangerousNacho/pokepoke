import type { RosterEntry } from '../engine/stats';

/**
 * Roster storage. Everything lives in one localStorage key so an export is a
 * single JSON blob the user can hand to someone else.
 *
 * localStorage is per-browser-per-device: this is a permanent bank on THIS
 * device, not a synced account. Export/import is the deliberate escape hatch.
 */

const KEY = 'pokepoke.profiles.v1';

export interface TrainerProfile {
  id: string;
  name: string;
  roster: RosterEntry[];
}

export interface ProfileStore {
  version: 1;
  activeProfileId: string;
  profiles: TrainerProfile[];
}

const newId = () => `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function emptyStore(): ProfileStore {
  const first: TrainerProfile = { id: newId(), name: 'Me', roster: [] };
  return { version: 1, activeProfileId: first.id, profiles: [first] };
}

/** Narrow an unknown blob to a store, discarding anything malformed. */
function parseStore(raw: unknown): ProfileStore | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Partial<ProfileStore>;
  if (!Array.isArray(s.profiles) || s.profiles.length === 0) return null;

  const profiles = s.profiles.filter(
    (p): p is TrainerProfile =>
      typeof p?.id === 'string' && typeof p?.name === 'string' && Array.isArray(p?.roster),
  );
  if (profiles.length === 0) return null;

  const activeProfileId = profiles.some((p) => p.id === s.activeProfileId)
    ? (s.activeProfileId as string)
    : profiles[0].id;

  return { version: 1, activeProfileId, profiles };
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
  const profile: TrainerProfile = { id: newId(), name: name.trim() || 'Trainer', roster: [] };
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

export function updateRoster(store: ProfileStore, id: string, roster: RosterEntry[]): ProfileStore {
  return {
    ...store,
    profiles: store.profiles.map((p) => (p.id === id ? { ...p, roster } : p)),
  };
}

export function renameProfile(store: ProfileStore, id: string, name: string): ProfileStore {
  return {
    ...store,
    profiles: store.profiles.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)),
  };
}

export function activeProfile(store: ProfileStore): TrainerProfile {
  return store.profiles.find((p) => p.id === store.activeProfileId) ?? store.profiles[0];
}
