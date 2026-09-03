import { useRef, useState } from 'react';
import {
  addProfile, activeProfile, applyImport, exportStore, previewImport, removeProfile,
  renameProfile, type ImportDecision, type ImportPreview, type ProfileStore,
} from '../storage/profiles';

interface Props {
  store: ProfileStore;
  onChange: (store: ProfileStore) => void;
  /** Applies a change that can be taken back, for destructive edits. */
  onUndoableChange: (label: string, store: ProfileStore) => void;
}

export function ProfileBar({ store, onChange, onUndoableChange }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ImportDecision>>({});
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

  /**
   * Reads the file and shows what it would do. Nothing is written until the
   * user confirms — importing used to replace the whole store outright, which
   * silently destroyed the receiving device's rosters.
   */
  const upload = async (file: File) => {
    setError(null);
    try {
      const preview = previewImport(await file.text(), store);
      setPending(preview);
      setDecisions(
        Object.fromEntries(preview.candidates.map((c) => [c.profile.id, c.suggested])),
      );
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
          onClick={() =>
            onUndoableChange(`Deleted ${current.name}`, removeProfile(store, current.id))
          }
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

      {pending && (
        <ImportReview
          preview={pending}
          decisions={decisions}
          onSet={(id, d) => setDecisions((s) => ({ ...s, [id]: d }))}
          onCancel={() => setPending(null)}
          onApply={() => {
            onChange(applyImport(store, pending, decisions));
            setPending(null);
          }}
        />
      )}

      {error && <p className="small" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{error}</p>}
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Saved on this device only. Export to move rosters to another phone.
      </p>
    </div>
  );
}

function ImportReview({ preview, decisions, onSet, onApply, onCancel }: {
  preview: ImportPreview;
  decisions: Record<string, ImportDecision>;
  onSet: (profileId: string, decision: ImportDecision) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const changing = preview.candidates.filter((c) => decisions[c.profile.id] !== 'skip').length;
  const age = preview.exportedAt ? describeAge(preview.exportedAt) : null;

  return (
    <div className="card" style={{ marginTop: 10, borderColor: 'var(--accent)' }}>
      <h3>Import {preview.candidates.length === 1 ? 'this trainer' : 'these trainers'}?</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        {age ? `Exported ${age}. ` : ''}Nothing changes until you choose Import.
      </p>

      {preview.candidates.map(({ profile, existing }) => (
        <div key={profile.id} style={{ marginTop: 10 }}>
          <div className="spread">
            <strong>{profile.name}</strong>
            <span className="small muted">{profile.roster.length} Pokémon</span>
          </div>
          <select
            style={{ width: '100%', marginTop: 4 }}
            aria-label={`What to do with ${profile.name}`}
            value={decisions[profile.id] ?? 'skip'}
            onChange={(e) => onSet(profile.id, e.target.value as ImportDecision)}
          >
            {existing && (
              <option value="replace">
                Replace “{existing.name}” here ({existing.roster.length} Pokémon will be lost)
              </option>
            )}
            <option value="add">Add as a new trainer</option>
            <option value="skip">Skip</option>
          </select>
        </div>
      ))}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" disabled={changing === 0} onClick={onApply}>
          Import {changing}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** "3 days ago" — enough to spot a stale file without a date library. */
function describeAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'at an unknown time';
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? 'about a month ago' : `about ${months} months ago`;
}
