import { useState } from 'react';
import type { ProfileStore } from '../storage/profiles';
import {
  httpFetchers, loadSyncSettings, saveSyncSettings, syncStore,
  type SyncResult, type SyncSettings,
} from '../storage/sync';

interface Props {
  store: ProfileStore;
  /** Applied so a surprising sync can be taken back, like any other edit. */
  onSynced: (label: string, store: ProfileStore) => void;
}

/**
 * Optional cross-device sync.
 *
 * Deliberately opt-in and clearly secondary to export/import: everything works
 * without it, and a Worker being down or a passphrase being wrong must never
 * be more than an error message.
 */
export function SyncPanel({ store, onSynced }: Props) {
  const [settings, setSettings] = useState<SyncSettings | null>(loadSyncSettings);
  const [editing, setEditing] = useState(settings === null);
  const [endpoint, setEndpoint] = useState(settings?.endpoint ?? '');
  const [secret, setSecret] = useState(settings?.secret ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<SyncResult | null>(null);

  const save = () => {
    const next = { endpoint: endpoint.trim().replace(/\/+$/, ''), secret: secret.trim() };
    if (!next.endpoint || !next.secret) {
      setError('Both the address and the passphrase are needed.');
      return;
    }
    saveSyncSettings(next);
    setSettings(next);
    setEditing(false);
    setError(null);
  };

  const disconnect = () => {
    saveSyncSettings(null);
    setSettings(null);
    setEditing(true);
    setLast(null);
  };

  const run = async () => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      const { store: next, result } = await syncStore(store, httpFetchers(settings));
      setLast(result);
      if (result.pulled.length > 0) {
        onSynced(`Synced — updated ${result.pulled.join(', ')}`, next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="spread">
        <strong>Sync across devices</strong>
        {settings && !editing && (
          <button className="ghost" onClick={() => setEditing(true)}>Settings</button>
        )}
      </div>

      {editing ? (
        <>
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="sync-endpoint">Sync address</label>
            <input
              id="sync-endpoint"
              placeholder="https://pokepoke-sync.you.workers.dev"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="sync-secret">Household passphrase</label>
            <input
              id="sync-secret"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={save}>Save</button>
            {settings && <button onClick={() => setEditing(false)}>Cancel</button>}
            {settings && <button className="ghost danger" onClick={disconnect}>Disconnect</button>}
          </div>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Optional. Everything works without it — this just saves passing an
            export file between phones. The passphrase is shared with your
            household, not a personal password.
          </p>
        </>
      ) : (
        <>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy} onClick={() => void run()}>
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          {last && (
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              {last.pushed.length === 0 && last.pulled.length === 0
                ? 'Already up to date.'
                : [
                    last.pushed.length ? `Sent ${last.pushed.join(', ')}` : null,
                    last.pulled.length ? `Received ${last.pulled.join(', ')}` : null,
                  ].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Each trainer syncs separately, newest edit wins. If two devices edit
            the same trainer, the older edit is lost — so sync before and after
            a big change rather than saving it all up.
          </p>
        </>
      )}

      {error && <p className="small" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{error}</p>}
    </div>
  );
}
