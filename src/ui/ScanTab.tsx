import { useRef, useState } from 'react';
import { estimateLevel, isPlausibleCp } from '../engine/estimateLevel';
import { bestMoveset } from '../engine/moveset';
import { getSpecies } from '../engine/gamemaster';
import type { RosterEntry } from '../engine/stats';
import { CONFIDENT_MATCH } from '../scan/parse';
import { matchSpeciesName } from '../scan/match';
import type { ScanResult } from '../scan/ocr';
import { speciesName } from './format';
import { SpeciesPicker } from './SpeciesPicker';

interface Props {
  onImport: (entries: RosterEntry[]) => void;
}

/** One row of the review screen: a scan the user can correct before saving. */
interface Draft {
  id: number;
  file: string;
  previewUrl: string;
  speciesId: string | null;
  cp: number | null;
  alternatives: string[];
  nameText: string | null;
  rawText: string;
  include: boolean;
}

function toDraft(r: ScanResult, id: number): Draft {
  return {
    id,
    file: r.file,
    previewUrl: r.previewUrl,
    speciesId: r.speciesId,
    cp: r.cp,
    alternatives: r.matches.slice(0, 5).map((m) => m.species.id),
    nameText: r.nameText,
    rawText: r.rawText,
    include: r.speciesId !== null && r.cp !== null,
  };
}

function draftToEntry(d: Draft): RosterEntry | null {
  if (!d.speciesId || d.cp === null) return null;
  const { level } = estimateLevel(d.speciesId, d.cp);
  const best = bestMoveset(d.speciesId);
  const species = getSpecies(d.speciesId);
  return {
    speciesId: d.speciesId,
    level,
    // A scan cannot see IVs. Assumed, and the review screen says so.
    ivs: { attack: 15, defense: 15, stamina: 15 },
    fastMove: best?.fastMove ?? species.fastMoves[0],
    chargedMove: best?.chargedMove ?? species.chargedMoves[0],
  };
}

export function ScanTab({ onImport }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (files: File[]) => {
    setError(null);
    setBusy('Loading text recognition (first run downloads a few MB)…');
    try {
      const { scanScreenshots } = await import('../scan/ocr');
      const results = await scanScreenshots(files, (p) =>
        setBusy(`${p.file}: ${p.status}…`),
      );
      setDrafts((prev) => [...prev, ...results.map((r, i) => toDraft(r, Date.now() + i))]);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Scan failed: ${e.message}`
          : 'Scan failed. Text recognition needs a network connection the first time.',
      );
    } finally {
      setBusy(null);
    }
  };

  const update = (id: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const commit = () => {
    const entries = drafts.filter((d) => d.include).map(draftToEntry).filter((e): e is RosterEntry => e !== null);
    if (entries.length === 0) return;
    onImport(entries);
    for (const d of drafts) URL.revokeObjectURL(d.previewUrl);
    setDrafts([]);
  };

  const ready = drafts.filter((d) => d.include).length;

  return (
    <>
      <h2>Scan screenshots</h2>
      <div className="notice">
        <strong>Screenshots only.</strong> Pick images from your camera roll and
        this reads the text off them. It never touches the running game — no
        account, no login, no automation.
      </div>

      <div className="card">
        <button
          className="primary"
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Working…' : 'Choose screenshots'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) void run(files);
            e.target.value = '';
          }}
        />
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Take a screenshot of a Pokémon's detail screen — the one showing CP and
          its name. A handful at a time works best.
        </p>
        {busy && <p className="small" style={{ margin: '8px 0 0' }}>{busy}</p>}
        {error && <p className="small" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{error}</p>}
      </div>

      {drafts.length > 0 && (
        <>
          <div className="spread">
            <h2 style={{ margin: 0 }}>Review · {ready}/{drafts.length}</h2>
            <button className="primary" disabled={ready === 0} onClick={commit}>
              Add {ready} to roster
            </button>
          </div>
          <p className="small muted">
            OCR gets things wrong. Check each one before saving — levels are
            estimated from CP assuming 15/15/15 IVs, so they may be a little low.
          </p>

          {drafts.map((d) => (
            <div className="card" key={d.id}>
              <div className="row">
                <img
                  src={d.previewUrl}
                  alt=""
                  style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }}
                />
                <div className="grow">
                  <div className="spread">
                    <strong>{d.speciesId ? speciesName(d.speciesId) : 'Not recognised'}</strong>
                    <label className="small row tight" style={{ gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={d.include}
                        disabled={!d.speciesId || d.cp === null}
                        onChange={(e) => update(d.id, { include: e.target.checked })}
                        style={{ width: 18, height: 18 }}
                      />
                      Add
                    </label>
                  </div>
                  <div className="small muted">
                    read “{d.nameText ?? '—'}” from {d.file}
                  </div>
                </div>
              </div>

              <div className="grid-2" style={{ marginTop: 8 }}>
                <div className="field">
                  <label>Species</label>
                  <select
                    value={d.speciesId ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__search__') setPickingFor(d.id);
                      else update(d.id, { speciesId: v || null, include: Boolean(v) && d.cp !== null });
                    }}
                  >
                    <option value="">— not recognised —</option>
                    {[...new Set([...(d.speciesId ? [d.speciesId] : []), ...d.alternatives])].map((id) => (
                      <option key={id} value={id}>{speciesName(id)}</option>
                    ))}
                    <option value="__search__">Search all species…</option>
                  </select>
                </div>
                <div className="field">
                  <label>CP</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={d.cp ?? ''}
                    placeholder="not read"
                    onChange={(e) => {
                      const cp = e.target.value === '' ? null : Number(e.target.value);
                      update(d.id, { cp, include: cp !== null && d.speciesId !== null });
                    }}
                  />
                </div>
              </div>

              <Warnings draft={d} />

              {pickingFor === d.id && (
                <SpeciesPicker
                  onCancel={() => setPickingFor(null)}
                  onPick={(id) => {
                    update(d.id, { speciesId: id, include: d.cp !== null });
                    setPickingFor(null);
                  }}
                />
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}

/** Surfaces the specific reasons a row might be wrong, rather than a generic warning. */
function Warnings({ draft }: { draft: Draft }) {
  const notes: string[] = [];

  if (draft.speciesId && draft.nameText) {
    const top = matchSpeciesName(draft.nameText)[0];
    if (top && top.score < CONFIDENT_MATCH) {
      notes.push(`Name match is uncertain (${Math.round(top.score * 100)}%) — check the species.`);
    }
  }
  if (draft.speciesId && draft.cp !== null && !isPlausibleCp(draft.speciesId, draft.cp)) {
    notes.push(`CP ${draft.cp} is impossible for ${speciesName(draft.speciesId)} — likely a misread.`);
  }
  if (draft.speciesId && draft.cp !== null && isPlausibleCp(draft.speciesId, draft.cp)) {
    const est = estimateLevel(draft.speciesId, draft.cp);
    notes.push(
      `Level ${est.level}${est.approximate ? ' (approx)' : ''}, assuming 15/15/15 IVs.`,
    );
  }
  if (draft.cp === null) notes.push('No CP found — type it in.');
  if (!draft.speciesId) {
    notes.push(
      draft.nameText
        ? `Couldn't match “${draft.nameText}” to a species — pick one above.`
        : "Couldn't find a name on this image — pick the species above.",
    );
  }

  if (notes.length === 0) return null;
  return (
    <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
      {notes.map((n) => <li key={n}>{n}</li>)}
    </ul>
  );
}
