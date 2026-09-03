import { useRef, useState } from 'react';
import { isPlausibleCp } from '../engine/estimateLevel';
import { reconcile } from '../scan/reconcile';
import { bestMoveset } from '../engine/moveset';
import { getSpecies } from '../engine/gamemaster';
import { newId, type StoredPokemon } from '../storage/profiles';
import { CONFIDENT_MATCH } from '../scan/parse';
import { matchSpeciesName } from '../scan/match';
import type { ScanResult } from '../scan/ocr';
import { speciesName } from './format';
import { SpeciesPicker } from './SpeciesPicker';

interface Props {
  onImport: (entries: StoredPokemon[]) => void;
}

/** One row of the review screen: a scan the user can correct before saving. */
interface Draft {
  id: number;
  file: string;
  previewUrl: string;
  /** Kept so a bad scan can be reported with the image that caused it. */
  source: File | null;
  speciesId: string | null;
  cp: number | null;
  hp: number | null;
  /** Name-match candidates, then stats-based ones for renamed Pokémon. */
  alternatives: string[];
  nameText: string | null;
  types: string[];
  /** Family read off the candy label, e.g. FAMILY_EEVEE. */
  familyId: string | null;
  /** Power-up cost read off the button, and the levels it allows. */
  upgradeCost: { stardust: number; candy: number } | null;
  levelBand: { min: number; max: number } | null;
  /** True when the shortlist came from CP/HP because no name matched. */
  fromStats: boolean;
  debug: { pass: string; text: string }[];
  include: boolean;
}

function toDraft(r: ScanResult, id: number, source: File | null): Draft {
  const named = r.matches.slice(0, 5).map((m) => m.species.id);
  const fromStats = named.length === 0 && r.statsCandidates.length > 0;
  return {
    id,
    file: r.file,
    previewUrl: r.previewUrl,
    source,
    speciesId: r.speciesId,
    cp: r.cp,
    hp: r.hp,
    alternatives: fromStats ? r.statsCandidates.map((c) => c.speciesId) : named,
    nameText: r.nameText,
    types: r.types,
    familyId: r.familyId,
    upgradeCost: r.upgradeCost,
    levelBand: r.levelBand,
    fromStats,
    debug: r.debug,
    include: r.speciesId !== null && r.cp !== null,
  };
}

function draftToEntry(d: Draft): StoredPokemon | null {
  if (!d.speciesId || d.cp === null) return null;
  // Prefer the reconciled level: HP is read far more reliably than CP, so it
  // corrects a mangled CP rather than inheriting its error.
  const level = reconcile(d.speciesId, d.cp, d.hp, d.levelBand as never).level ?? 1;
  const best = bestMoveset(d.speciesId);
  const species = getSpecies(d.speciesId);
  return {
    id: newId('m'),
    speciesId: d.speciesId,
    level,
    // A scan cannot see IVs. 12/12/12 is nearer a typical caught Pokémon than
    // assuming a hundo, and the full IV range is only worth ~7% DPS anyway.
    // The review screen says the values are assumed.
    ivs: { attack: 12, defense: 12, stamina: 12 },
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
      setDrafts((prev) => [
        ...prev,
        ...results.map((r, i) => toDraft(r, Date.now() + i, files[i] ?? null)),
      ]);
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
    const entries = drafts.filter((d) => d.include).map(draftToEntry).filter((e): e is StoredPokemon => e !== null);
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
              <Diagnostics draft={d} />
              <button
                className="ghost small"
                style={{ marginTop: 6, padding: '4px 0' }}
                onClick={() => void downloadReport(d)}
              >
                Something wrong? Save a report
              </button>

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

/**
 * Bundles everything needed to reproduce a bad scan into one file.
 *
 * Every scanning fix so far came from being handed real screenshots. Without
 * this the loop requires noticing, screenshotting and describing the problem;
 * with it, a wrong row is one tap away from a report that contains the image,
 * every OCR pass verbatim, and what was concluded.
 *
 * Entirely local — it downloads a file. Nothing is sent anywhere.
 */
async function downloadReport(draft: Draft) {
  const image = draft.source
    ? await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => resolve('');
        reader.readAsDataURL(draft.source!);
      })
    : '';

  const report = {
    reportedAt: new Date().toISOString(),
    file: draft.file,
    // What the scanner concluded, so a report shows the mistake, not just input.
    read: {
      speciesId: draft.speciesId,
      nameText: draft.nameText,
      cp: draft.cp,
      hp: draft.hp,
      types: draft.types,
      familyId: draft.familyId,
      upgradeCost: draft.upgradeCost,
      levelBand: draft.levelBand,
      alternatives: draft.alternatives,
    },
    ocrPasses: draft.debug,
    // Layout varies by device and the crop regions are fractions of the image,
    // so screen shape is often the explanation.
    device: {
      userAgent: navigator.userAgent,
      screen: `${window.screen.width}x${window.screen.height}`,
      pixelRatio: window.devicePixelRatio,
    },
    image,
  };

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `pokepoke-scan-report-${draft.file.replace(/\.[^.]+$/, '')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Raw OCR output, collapsed. Without this a bad scan is unfixable guesswork —
 * seeing what was actually read tells you whether the image, the crop or the
 * matching is at fault.
 */
function Diagnostics({ draft }: { draft: Draft }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary className="small muted" style={{ cursor: 'pointer' }}>
        What the scanner read
      </summary>
      {draft.upgradeCost && (
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          Power-up cost: {draft.upgradeCost.stardust.toLocaleString()} dust /{' '}
          {draft.upgradeCost.candy} candy
          {draft.levelBand ? ` → level ${draft.levelBand.min}-${draft.levelBand.max}` : ''}
        </p>
      )}
      {draft.familyId && (
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          Candy family: {draft.familyId.replace('FAMILY_', '')}
        </p>
      )}
      {draft.types.length > 0 && (
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          Types detected: {draft.types.join(', ')}
        </p>
      )}
      {draft.hp !== null && (
        <p className="small muted" style={{ margin: '6px 0 0' }}>HP {draft.hp}</p>
      )}
      {draft.debug.map((d) => (
        <div key={d.pass} style={{ marginTop: 6 }}>
          <div className="small muted">{d.pass}</div>
          <pre className="small mono" style={{
            margin: 0, padding: 6, background: 'var(--surface-2)', borderRadius: 6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflow: 'auto',
          }}>{d.text || '(nothing)'}</pre>
        </div>
      ))}
    </details>
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
  if (draft.speciesId && (draft.cp !== null || draft.hp !== null)) {
    const r = reconcile(draft.speciesId, draft.cp, draft.hp, draft.levelBand as never);
    if (!r.consistent && r.expectedCp) {
      notes.push(
        `CP ${draft.cp} doesn't fit HP ${draft.hp} — expected roughly ` +
        `${r.expectedCp.min}-${r.expectedCp.max}. The CP was probably misread; ` +
        `using HP for the level instead. Correct it above if you can read it.`,
      );
    }
    if (r.level !== null) {
      notes.push(
        `Level ${r.level}, from ${r.source === 'hp' ? 'HP' : r.source === 'cp' ? 'CP' : 'CP and HP'}.`,
      );
    }
  }
  if (draft.cp === null) notes.push('No CP found — type it in.');
  if (!draft.speciesId) {
    if (draft.fromStats) {
      notes.push(
        `No species name on screen — probably renamed. Narrowed to ` +
        `${draft.alternatives.length} candidate${draft.alternatives.length === 1 ? '' : 's'} ` +
        `from CP${draft.hp !== null ? ' and HP' : ''}` +
        `${draft.types.length ? `, type ${draft.types.join('/')}` : ''}` +
        `${draft.familyId ? `, ${draft.familyId.replace('FAMILY_', '').toLowerCase()} candy` : ''}` +
        ` — pick yours above.`,
      );
    } else {
      notes.push(
        draft.nameText
          ? `Couldn't match “${draft.nameText}” to a species — pick one above.`
          : "Couldn't find a name on this image — pick the species above.",
      );
    }
  }

  if (notes.length === 0) return null;
  return (
    <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
      {notes.map((n) => <li key={n}>{n}</li>)}
    </ul>
  );
}
