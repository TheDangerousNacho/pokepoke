import type { ProfileStore, TrainerProfile } from './profiles';

/**
 * Cross-device roster sync.
 *
 * localStorage stays the source of truth. Sync is a reconciliation that runs
 * when asked and is allowed to fail: the app must work at a raid gym with no
 * signal, so nothing here may become a dependency of loading or using it.
 *
 * Reconciliation is per profile and last-write-wins on `updatedAt`. That is a
 * deliberate limit, not an oversight — it handles the real case (different
 * people editing their own rosters) without conflict rules a household does
 * not need. Two devices editing the SAME profile will still lose one side's
 * edit, which is why the result reports exactly what moved.
 */

const SETTINGS_KEY = 'pokepoke.sync.v1';

export interface SyncSettings {
  /** Worker URL, e.g. https://pokepoke-sync.someone.workers.dev */
  endpoint: string;
  /** Household passphrase. Shared, not secret from family members. */
  secret: string;
}

export interface SyncResult {
  pushed: string[];
  pulled: string[];
  unchanged: number;
  at: string;
}

export function loadSyncSettings(): SyncSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    if (typeof parsed.endpoint !== 'string' || typeof parsed.secret !== 'string') return null;
    if (!parsed.endpoint || !parsed.secret) return null;
    return { endpoint: parsed.endpoint.replace(/\/+$/, ''), secret: parsed.secret };
  } catch {
    return null;
  }
}

export function saveSyncSettings(settings: SyncSettings | null): void {
  try {
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    else localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // Storage unavailable; sync simply stays unconfigured for this session.
  }
}

async function call(
  settings: SyncSettings,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${settings.endpoint}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${settings.secret}` },
  });
  if (res.status === 401) throw new Error('Wrong household passphrase.');
  if (!res.ok) throw new Error(`Sync failed (${res.status}).`);
  return res;
}

/** Newer of two ISO timestamps, treating anything unparseable as oldest. */
function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = a ? Date.parse(a) : NaN;
  const tb = b ? Date.parse(b) : NaN;
  if (Number.isNaN(ta)) return false;
  if (Number.isNaN(tb)) return true;
  return ta > tb;
}

export interface RemoteIndexEntry {
  id: string;
  updatedAt: string | null;
  name: string | null;
}

/**
 * Reconciles local and remote, returning the new store and what moved.
 *
 * Pure apart from the network calls it is handed, so the merge rules are
 * testable without a server.
 */
export async function syncStore(
  store: ProfileStore,
  fetchers: {
    index: () => Promise<RemoteIndexEntry[]>;
    get: (id: string) => Promise<TrainerProfile>;
    put: (profile: TrainerProfile) => Promise<void>;
  },
): Promise<{ store: ProfileStore; result: SyncResult }> {
  const remote = await fetchers.index();
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const localById = new Map(store.profiles.map((p) => [p.id, p]));

  const pushed: string[] = [];
  const pulled: string[] = [];
  let unchanged = 0;

  // Push anything local that is missing remotely or newer than the remote copy.
  for (const local of store.profiles) {
    const entry = remoteById.get(local.id);
    if (!entry || isNewer(local.updatedAt, entry.updatedAt)) {
      await fetchers.put(local);
      pushed.push(local.name);
    } else if (!isNewer(entry.updatedAt, local.updatedAt)) {
      unchanged++;
    }
  }

  // Pull anything remote that is missing locally or newer than the local copy.
  const profiles = [...store.profiles];
  for (const entry of remote) {
    const local = localById.get(entry.id);
    if (local && !isNewer(entry.updatedAt, local.updatedAt)) continue;

    const fetched = await fetchers.get(entry.id);
    const at = profiles.findIndex((p) => p.id === entry.id);
    if (at >= 0) profiles[at] = fetched;
    else profiles.push(fetched);
    pulled.push(fetched.name);
  }

  return {
    store: {
      ...store,
      profiles,
      // Keep pointing at a profile that still exists; a pull can replace the
      // active one but should never leave the selector dangling.
      activeProfileId: profiles.some((p) => p.id === store.activeProfileId)
        ? store.activeProfileId
        : profiles[0]?.id ?? store.activeProfileId,
    },
    result: { pushed, pulled, unchanged, at: new Date().toISOString() },
  };
}

/** Wires `syncStore` to a real Worker. */
export function httpFetchers(settings: SyncSettings) {
  return {
    index: async () => {
      const res = await call(settings, '/profiles');
      return (await res.json() as { profiles: RemoteIndexEntry[] }).profiles;
    },
    get: async (id: string) => {
      const res = await call(settings, `/profiles/${encodeURIComponent(id)}`);
      return await res.json() as TrainerProfile;
    },
    put: async (profile: TrainerProfile) => {
      await call(settings, `/profiles/${encodeURIComponent(profile.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
    },
  };
}
