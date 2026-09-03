import { useRef, useState } from 'react';
import {
  addProfile, activeProfile, exportStore, importStore, removeProfile, renameProfile,
  type ProfileStore,
} from '../storage/profiles';

interface Props {
  store: ProfileStore;
  onChange: (store: ProfileStore) => void;
}

export function ProfileBar({ store, onChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = activeProfile(store);

  const download = () => {
    const blob = new Blob([exportStore(store)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pokepoke-roster.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File) => {
    setError(null);
    try {
      onChange(importStore(await file.text()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  };

  return (
    <div className="card">
      <div className="row">
        <select
          className="grow"
          value={store.activeProfileId}
          onChange={(e) => onChange({ ...store, activeProfileId: e.target.value })}
          aria-label="Trainer"
        >
          {store.profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.roster.length})</option>
          ))}
        </select>
        <button
          onClick={() => {
            const name = prompt('Trainer name?');
            if (name) onChange(addProfile(store, name));
          }}
        >
          + Trainer
        </button>
      </div>

      <div className="row tight" style={{ marginTop: 8 }}>
        <button
          className="ghost"
          onClick={() => {
            const name = prompt('Rename trainer', current.name);
            if (name) onChange(renameProfile(store, current.id, name));
          }}
        >
          Rename
        </button>
        <button className="ghost" onClick={download}>Export</button>
        <button className="ghost" onClick={() => fileRef.current?.click()}>Import</button>
        <span className="grow" />
        <button
          className="ghost danger"
          disabled={store.profiles.length === 1}
          onClick={() => {
            if (confirm(`Delete ${current.name} and their ${current.roster.length} Pokémon?`)) {
              onChange(removeProfile(store, current.id));
            }
          }}
        >
          Delete
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />

      {error && <p className="small" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{error}</p>}
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Saved on this device only. Export to move rosters to another phone.
      </p>
    </div>
  );
}
