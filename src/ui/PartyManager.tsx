import { useState } from 'react';
import type { SavedParty, StoredPokemon, TrainerProfile } from '../storage/profiles';
import { speciesName } from './format';

interface Props {
  profile: TrainerProfile;
  onSave: (party: Omit<SavedParty, 'id'> & { id?: string }) => void;
  onDelete: (partyId: string) => void;
}

const MAX_PARTY = 6;

/**
 * Named parties for a trainer.
 *
 * The Results tab picks a best six automatically, which is usually the right
 * answer. These exist for when it isn't — a team you know works, one you are
 * levelling, or the six you actually have revives for.
 */
export function PartyManager({ profile, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState<SavedParty | 'new' | null>(null);

  if (profile.roster.length === 0) return null;

  return (
    <>
      <div className="spread">
        <h2 style={{ margin: 0 }}>Parties · {profile.parties.length}</h2>
        <button onClick={() => setEditing('new')} disabled={editing !== null}>New party</button>
      </div>

      {editing && (
        <PartyEditor
          roster={profile.roster}
          party={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={(p) => { onSave(p); setEditing(null); }}
        />
      )}

      {profile.parties.length === 0 && !editing && (
        <p className="small muted">
          None saved. Results picks your best six for each boss on its own —
          save a party only when you want to override that.
        </p>
      )}

      {profile.parties.map((party) => {
        const members = profile.roster.filter((e) => party.memberIds.includes(e.id));
        return (
          <div className="card" key={party.id}>
            <div className="spread">
              <strong>{party.name}</strong>
              <span className="row tight">
                <button className="ghost" onClick={() => setEditing(party)}>Edit</button>
                <button className="ghost danger" onClick={() => onDelete(party.id)}>Delete</button>
              </span>
            </div>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {members.length === 0
                ? 'Empty'
                : members.map((e) => speciesName(e.speciesId)).join(', ')}
            </p>
          </div>
        );
      })}
    </>
  );
}

function PartyEditor({ roster, party, onSave, onCancel }: {
  roster: StoredPokemon[];
  party: SavedParty | null;
  onSave: (party: Omit<SavedParty, 'id'> & { id?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(party?.name ?? '');
  const [members, setMembers] = useState<string[]>(party?.memberIds ?? []);

  const toggle = (id: string) =>
    setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const full = members.length >= MAX_PARTY;

  return (
    <div className="card">
      <div className="field">
        <label htmlFor="party-name">Party name</label>
        <input
          id="party-name"
          autoFocus
          placeholder="e.g. Ice counters"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <p className="small muted" style={{ margin: '10px 0 4px' }}>
        {members.length}/{MAX_PARTY} chosen
      </p>
      <div className="picker-results">
        {roster.map((entry) => {
          const checked = members.includes(entry.id);
          return (
            <label
              key={entry.id}
              className="row"
              style={{ padding: '9px 11px', opacity: !checked && full ? 0.45 : 1 }}
            >
              <input
                type="checkbox"
                checked={checked}
                // A raid party is six; stop at six rather than silently
                // truncating later.
                disabled={!checked && full}
                onChange={() => toggle(entry.id)}
                style={{ width: 18, height: 18 }}
              />
              <span className="grow">{speciesName(entry.speciesId)}</span>
              <span className="small muted">L{entry.level}</span>
            </label>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="primary"
          disabled={members.length === 0}
          onClick={() => onSave({ id: party?.id, name, memberIds: members })}
        >
          {party ? 'Save changes' : 'Save party'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
