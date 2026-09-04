import { useState } from 'react';
import type { Rotation } from '../storage/rotation';
import { getSpecies } from '../engine/gamemaster';
import { getTier, type RaidTier } from '../engine/raidTiers';
import { buildBoss, type RaidBossSpec } from '../engine/stats';
import { CustomBoss } from './CustomBoss';
import { bossName, moveName } from './format';
import { TypeChip } from './TypeChip';

export interface BossListEntry extends RaidBossSpec {
  shiny?: boolean;
  /** Built by hand rather than taken from the rotation feed. */
  custom?: boolean;
}

const TIER_ORDER: RaidTier[] = ['1', '3', '4', '5', '6', 'MEGA', 'MEGA_LEGENDARY', 'ELITE', 'SHADOW_3', 'SHADOW_5'];

const TIER_LABEL: Record<RaidTier, string> = {
  '1': 'Tier 1', '3': 'Tier 3', '4': 'Tier 4', '5': 'Tier 5', '6': 'Tier 6',
  MEGA: 'Mega', MEGA_LEGENDARY: 'Mega Legendary', ELITE: 'Elite',
  SHADOW_3: 'Shadow T3', SHADOW_5: 'Shadow T5',
};

interface Props {
  rotation: Rotation;
  selected: BossListEntry | null;
  onSelect: (boss: BossListEntry) => void;
  onChangeMoves: (boss: BossListEntry) => void;
  onRefresh: () => Promise<void>;
}

export function BossPicker({ rotation, selected, onSelect, onChangeMoves, onRefresh }: Props) {
  const grouped = TIER_ORDER
    .map((tier) => ({ tier, bosses: rotation.bosses.filter((b) => b.tier === tier) }))
    .filter((g) => g.bosses.length > 0);

  const isSelected = (b: BossListEntry) =>
    selected?.speciesId === b.speciesId &&
    selected?.tier === b.tier &&
    selected?.megaId === b.megaId;

  return (
    <>
      <div className="spread">
        <h2 style={{ margin: 0 }}>Current raid bosses</h2>
        <RefreshButton onRefresh={onRefresh} />
      </div>
      <p className="small muted" style={{ margin: '4px 0 10px' }}>
        Rotation from {new Date(rotation.fetchedAt).toLocaleDateString()}
        {rotation.refreshed ? '' : ', shipped with the app'}.
      </p>

      {grouped.map(({ tier, bosses }) => (
        <section key={tier}>
          <h2>{TIER_LABEL[tier]} · {getTier(tier).bossHp.toLocaleString()} HP · {getTier(tier).timerSeconds}s</h2>
          <div className="boss-list">
            {bosses.map((b) => (
              <button
                key={`${b.tier}-${b.speciesId}-${b.megaId ?? ''}`}
                className="boss card"
                aria-pressed={isSelected(b)}
                onClick={() => onSelect(b)}
              >
                <span className="grow">
                  <strong>{bossName(b)}</strong>
                  <span className="types" style={{ marginTop: 4 }}>
                    {buildBoss(b).types.map((t) => (
                      <TypeChip key={t} type={t} />
                    ))}
                  </span>
                </span>
                <span className="tier">{TIER_LABEL[b.tier]}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <CustomBoss selected={selected} onSelect={onSelect} />

      {selected && <BossMoveset boss={selected} onChange={onChangeMoves} />}
    </>
  );
}

/**
 * Pulls the live rotation.
 *
 * Its own component so a failed fetch reports itself in place — the boss list
 * you already have keeps working, which is the whole point of shipping one
 * with the build.
 */
function RefreshButton({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'busy'>('idle');
  const [error, setError] = useState<string | null>(null);

  return (
    <span style={{ textAlign: 'right' }}>
      <button
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          setError(null);
          try {
            await onRefresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Refresh failed.');
          } finally {
            setState('idle');
          }
        }}
      >
        {state === 'busy' ? 'Refreshing…' : 'Refresh'}
      </button>
      {error && <div className="small" style={{ color: 'var(--bad)', marginTop: 4 }}>{error}</div>}
    </span>
  );
}

/**
 * The rotation feed doesn't carry movesets, and the boss's moveset only affects
 * how fast your attackers faint. Defaulted, but adjustable when you know it.
 */
function BossMoveset({ boss, onChange }: { boss: BossListEntry; onChange: (b: BossListEntry) => void }) {
  const species = getSpecies(boss.speciesId);
  const fast = [...species.fastMoves, ...species.eliteFastMoves];
  const charged = [...species.chargedMoves, ...species.eliteChargedMoves];

  return (
    <div className="card">
      <h3>{bossName(boss)}'s moveset</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Not published with the rotation. This only changes how quickly your team
        faints, not how much damage you need.
      </p>
      <div className="grid-2">
        <div className="field">
          <label>Fast move</label>
          <select value={boss.fastMove} onChange={(e) => onChange({ ...boss, fastMove: e.target.value })}>
            {fast.map((m) => <option key={m} value={m}>{moveName(m)}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Charged move</label>
          <select value={boss.chargedMove} onChange={(e) => onChange({ ...boss, chargedMove: e.target.value })}>
            {charged.map((m) => <option key={m} value={m}>{moveName(m)}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
