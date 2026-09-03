import { useMemo, useState } from 'react';
import type { BattleConditions } from '../engine/damage';
import type { RaidBossSpec, RosterEntry } from '../engine/stats';
import { rankUpgrades, type MoveUpgrade } from '../engine/upgrades';
import { BOSSES, type BossListEntry } from './BossPicker';
import { moveName, speciesName } from './format';

interface Props {
  roster: RosterEntry[];
  /** The boss selected on the Boss tab, if any. */
  selectedBoss: BossListEntry | null;
  conditions: BattleConditions;
}

type Target = 'rotation' | 'selected';

/** Tier 5 and mega bosses are what a TM decision is usually about. */
const HARD_TIERS = new Set(['5', '6', 'MEGA', 'MEGA_LEGENDARY', 'ELITE', 'SHADOW_5']);

export function Upgrades({ roster, selectedBoss, conditions }: Props) {
  const [target, setTarget] = useState<Target>('rotation');

  const bosses = useMemo<RaidBossSpec[]>(() => {
    if (target === 'selected' && selectedBoss) return [selectedBoss];
    const hard = BOSSES.filter((b) => HARD_TIERS.has(b.tier));
    return (hard.length > 0 ? hard : BOSSES) as RaidBossSpec[];
  }, [target, selectedBoss]);

  const upgrades = useMemo(
    () => (roster.length > 0 && bosses.length > 0 ? rankUpgrades(roster, bosses, { conditions }) : []),
    [roster, bosses, conditions],
  );

  if (roster.length === 0) {
    return <p className="empty">Add some Pokémon to your roster first.</p>;
  }

  return (
    <>
      <h2>Worth a TM?</h2>
      <div className="card">
        <div className="field">
          <label htmlFor="target">Rate against</label>
          <select id="target" value={target} onChange={(e) => setTarget(e.target.value as Target)}>
            <option value="rotation">
              Current hard raids ({bosses.length > 0 ? bosses.map((b) => speciesName(b.speciesId)).join(', ') : 'none'})
            </option>
            <option value="selected" disabled={!selectedBoss}>
              {selectedBoss ? `Just ${speciesName(selectedBoss.speciesId)}` : 'Pick a boss first'}
            </option>
          </select>
        </div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Rated against who you'd actually fight, not a theoretical best case.
          Movesets already at their best are hidden.
        </p>
      </div>

      {upgrades.length === 0 ? (
        <p className="empty">
          Nothing worth a TM right now — every Pokémon here is within a few
          percent of its best moveset against these bosses.
        </p>
      ) : (
        upgrades.map((u) => <UpgradeCard key={`${u.speciesId}-${u.current.fastMove}`} upgrade={u} />)
      )}

      <p className="small muted">
        Ordinary TMs reroll at random, so “~4 TMs” is the expected number of
        tries, not a price. Elite TMs let you pick, and are ranked by gain per
        TM spent because that's the scarce one.
      </p>
    </>
  );
}

function UpgradeCard({ upgrade: u }: { upgrade: MoveUpgrade }) {
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;

  return (
    <div className="card">
      <div className="spread">
        <h3>{speciesName(u.speciesId)}</h3>
        <span className="tier" style={{ color: 'var(--good)', borderColor: 'var(--good)' }}>
          {pct(u.gain)} DPS
        </span>
      </div>

      <table className="results-table" style={{ marginTop: 4 }}>
        <tbody>
          <tr>
            <td style={{ borderTop: 'none' }}>
              <div className="small muted">Now</div>
              <div>{moveName(u.current.fastMove)} · {moveName(u.current.chargedMove)}</div>
            </td>
            <td className="mono" style={{ borderTop: 'none' }}>{u.current.dps.toFixed(1)}</td>
          </tr>
          <tr>
            <td>
              <div className="small muted">
                Best {u.eliteTms > 0 ? `· ${u.eliteTms} Elite TM${u.eliteTms > 1 ? 's' : ''}` : `· ~${u.expectedRegularTms} ordinary TMs`}
              </div>
              <div><strong>{moveName(u.best.fastMove)} · {moveName(u.best.chargedMove)}</strong></div>
            </td>
            <td className="mono"><strong>{u.best.dps.toFixed(1)}</strong></td>
          </tr>
          {u.bestWithoutElite && (
            <tr>
              <td>
                <div className="small muted">Without an Elite TM</div>
                <div>{moveName(u.bestWithoutElite.fastMove)} · {moveName(u.bestWithoutElite.chargedMove)}</div>
              </td>
              <td className="mono">{u.bestWithoutElite.dps.toFixed(1)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {u.losesLegacyMove && (
        <p className="small" style={{ color: 'var(--warn)', margin: '8px 0 0' }}>
          This replaces a legacy move. You'd need another Elite TM to get it back.
        </p>
      )}
    </div>
  );
}
