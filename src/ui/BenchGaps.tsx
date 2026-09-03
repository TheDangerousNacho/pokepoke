import { findBenchGaps, type BenchGap } from '../engine/bench';
import type { BattleConditions } from '../engine/damage';
import type { RaidBossSpec, RosterEntry } from '../engine/stats';
import { bossName, moveName, speciesName } from './format';
import { useDeferredCompute } from './useDeferredCompute';

interface Props {
  roster: RosterEntry[];
  bosses: RaidBossSpec[];
  conditions: BattleConditions;
}

/** Above this, the bench is fine and the row is noise. */
const COVERED = 0.8;

/**
 * The other half of "what should I invest in": which fights the roster is not
 * equipped for, and what to go and get. Sits under the TM advice because it is
 * the same question about a different resource — that one spends TMs on
 * Pokémon you have, this one spends time on Pokémon you don't.
 */
export function BenchGaps({ roster, bosses, conditions }: Props) {
  const { value: gaps, pending } = useDeferredCompute(
    () => (roster.length > 0 && bosses.length > 0 ? findBenchGaps(roster, bosses, { conditions }) : []),
    [roster, bosses, conditions],
  );

  const worst = gaps?.filter((g) => g.coverage < COVERED && g.candidates.length > 0) ?? [];

  return (
    <>
      <h2>Gaps in your bench{pending && <span className="small muted"> · updating…</span>}</h2>

      {!gaps ? (
        <p className="empty">Checking every species…</p>
      ) : worst.length === 0 ? (
        <p className="empty">
          Nothing glaring — you have a solid counter for every one of these
          bosses.
        </p>
      ) : (
        worst.map((gap) => <GapCard key={`${gap.boss.speciesId}-${gap.boss.tier}`} gap={gap} />)
      )}

      <p className="small muted">
        Measured against the best <em>ordinary</em> Pokémon for the job, not the
        best legendary — otherwise every bench would look bad and the number
        would say nothing you could act on. Candidates are rated at level 40
        with perfect IVs, which is what they become, not what you first catch.
      </p>
    </>
  );
}

function GapCard({ gap }: { gap: BenchGap }) {
  const pct = Math.round(gap.coverage * 100);

  return (
    <div className="card">
      <div className="spread">
        <h3>{bossName(gap.boss)}</h3>
        <span className="tier">{pct}% covered</span>
      </div>

      <div className="bar" style={{ margin: '2px 0 10px' }}>
        <span style={{ width: `${pct}%`, background: pct < 50 ? 'var(--bad)' : 'var(--warn)' }} />
      </div>

      <p className="small muted" style={{ margin: '0 0 8px' }}>
        {gap.best
          ? <>Your best is <strong>{speciesName(gap.best.speciesId)}</strong> at {gap.best.dps.toFixed(1)} DPS.</>
          : <>You have nothing to bring.</>}
      </p>

      <table className="results-table">
        <tbody>
          {gap.candidates.map((c) => (
            <tr key={c.speciesId}>
              <td>
                <div>
                  <strong>{speciesName(c.speciesId)}</strong>
                  {c.owned && <span className="small muted"> · you have one</span>}
                  {c.rarity !== 'NORMAL' && <span className="small muted"> · from raids</span>}
                </div>
                <div className="small muted">{moveName(c.fastMove)} · {moveName(c.chargedMove)}</div>
              </td>
              <td className="mono">{c.dps.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {gap.candidates.some((c) => c.owned) && (
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          One of these is already yours — powering it up is cheaper than
          starting over.
        </p>
      )}
    </div>
  );
}
