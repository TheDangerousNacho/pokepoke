import { useState } from 'react';
import { getSpecies } from '../engine/gamemaster';
import { bestMoveset } from '../engine/moveset';
import { combatPower } from '../engine/cpm';
import type { RosterEntry } from '../engine/stats';
import { newId, type StoredPokemon } from '../storage/profiles';
import { megaName, moveName, speciesName } from './format';
import { SpeciesPicker } from './SpeciesPicker';

interface Props {
  roster: StoredPokemon[];
  /** `removed` is set when the change deleted a Pokémon, so it can be undone. */
  onChange: (roster: StoredPokemon[], removed?: StoredPokemon) => void;
}

const LEVELS = Array.from({ length: 99 }, (_, i) => 1 + i * 0.5);
const IVS = Array.from({ length: 16 }, (_, i) => i);

function defaultEntry(speciesId: string): StoredPokemon {
  const s = getSpecies(speciesId);
  // Default to the species' best non-elite attacking moveset rather than
  // whatever the Game Master happens to list first — that would have given
  // Metagross "Psychic" over "Meteor Mash" and understated the team badly.
  const best = bestMoveset(speciesId);
  return {
    id: newId('m'),
    speciesId,
    level: 40,
    ivs: { attack: 15, defense: 15, stamina: 15 },
    fastMove: best?.fastMove ?? s.fastMoves[0] ?? s.eliteFastMoves[0],
    chargedMove: best?.chargedMove ?? s.chargedMoves[0] ?? s.eliteChargedMoves[0],
  };
}

function EntryCard({ entry, onChange, onRemove }: {
  entry: StoredPokemon;
  onChange: (e: StoredPokemon) => void;
  onRemove: () => void;
}) {
  const species = getSpecies(entry.speciesId);
  // Elite moves are appended so a Pokémon that already knows a legacy move can
  // be entered accurately, even though Phase 3 must not *recommend* them.
  const fastMoves = [...species.fastMoves, ...species.eliteFastMoves];
  const chargedMoves = [...species.chargedMoves, ...species.eliteChargedMoves];
  const cp = combatPower(species, entry.ivs, entry.level);

  const set = (patch: Partial<StoredPokemon>) => onChange({ ...entry, ...patch });
  const setIv = (k: keyof RosterEntry['ivs'], v: number) =>
    onChange({ ...entry, ivs: { ...entry.ivs, [k]: v } });

  return (
    <div className="card">
      <div className="spread">
        <h3>
          {speciesName(entry.speciesId)}
          {entry.megaId ? ` · ${megaName(entry.megaId)}` : ''}
          {entry.isShadow ? ' · Shadow' : ''}
        </h3>
        <button className="ghost danger" onClick={onRemove} aria-label="Remove">Remove</button>
      </div>
      <p className="small muted mono" style={{ margin: '0 0 10px' }}>CP {cp} · Level {entry.level}</p>

      <div className="grid-2">
        <div className="field">
          <label htmlFor={`lvl-${entry.speciesId}`}>Level</label>
          <select
            id={`lvl-${entry.speciesId}`}
            value={entry.level}
            onChange={(e) => set({ level: Number(e.target.value) })}
          >
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Variant</label>
          <select
            value={entry.megaId ?? (entry.isShadow ? 'SHADOW' : 'NORMAL')}
            onChange={(e) => {
              const v = e.target.value;
              set({
                isShadow: v === 'SHADOW',
                megaId: v.startsWith('TEMP_EVOLUTION') ? v : undefined,
              });
            }}
          >
            <option value="NORMAL">Normal</option>
            {species.hasShadow && <option value="SHADOW">Shadow</option>}
            {species.megas.map((m) => (
              <option key={m.id} value={m.id}>{megaName(m.id)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid-3" style={{ marginTop: 8 }}>
        {(['attack', 'defense', 'stamina'] as const).map((k) => (
          <div className="field" key={k}>
            <label>{k.slice(0, 3)} IV</label>
            <select value={entry.ivs[k]} onChange={(e) => setIv(k, Number(e.target.value))}>
              {IVS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 8 }}>
        <div className="field">
          <label>Fast move</label>
          <select value={entry.fastMove} onChange={(e) => set({ fastMove: e.target.value })}>
            {fastMoves.map((m) => <option key={m} value={m}>{moveName(m)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Charged move</label>
          <select value={entry.chargedMove} onChange={(e) => set({ chargedMove: e.target.value })}>
            {chargedMoves.map((m) => <option key={m} value={m}>{moveName(m)}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

export function RosterEditor({ roster, onChange }: Props) {
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="spread">
        <h2 style={{ margin: 0 }}>Roster · {roster.length}</h2>
        <button className="primary" onClick={() => setAdding(true)}>Add Pokémon</button>
      </div>

      {adding && (
        <SpeciesPicker
          onCancel={() => setAdding(false)}
          onPick={(id) => {
            onChange([...roster, defaultEntry(id)]);
            setAdding(false);
          }}
        />
      )}

      {roster.length === 0 && !adding && (
        <p className="empty">
          Nothing here yet. Add the Pokémon you'd actually bring to a raid —
          they're saved on this device, so you only enter them once.
        </p>
      )}

      {roster.map((entry, i) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          onChange={(next) => onChange(roster.map((e, j) => (j === i ? next : e)))}
          onRemove={() => onChange(roster.filter((_, j) => j !== i), entry)}
        />
      ))}
    </>
  );
}
