import { useMemo } from 'react';
import type { BattleConditions } from '../engine/damage';
import { rankAttackers, simulateParty, timeToWin } from '../engine/simulate';
import type { RosterEntry } from '../engine/stats';
import type { BossListEntry } from './BossPicker';
import { formatSeconds, moveName, speciesName } from './format';

interface Props {
  boss: BossListEntry | null;
  roster: RosterEntry[];
  conditions: BattleConditions;
}

/** The six highest-DPS Pokémon are what you'd actually bring. */
const PARTY_SIZE = 6;

export function Results({ boss, roster, conditions }: Props) {
  const result = useMemo(() => {
    if (!boss || roster.length === 0) return null;

    const ranked = rankAttackers(roster, boss, { conditions });
    const party = ranked
      .slice(0, PARTY_SIZE)
      .map((r) => roster.find((e) => e.speciesId === r.speciesId && e.fastMove === r.fastMove)!)
      .filter(Boolean);

    const sim = simulateParty(party, boss, { conditions });
    return { ranked, sim, estimates: [1, 2, 3].map((n) => timeToWin(sim, n)) };
  }, [boss, roster, conditions]);

  if (!boss) return <p className="empty">Pick a raid boss first.</p>;
  if (roster.length === 0) return <p className="empty">Add some Pokémon to your roster first.</p>;
  if (!result) return null;

  const { ranked, sim, estimates } = result;

  return (
    <>
      <div className="notice">
        <strong>Estimates, not guarantees.</strong> The battle simulation hasn't been
        checked against an independent simulator yet, and it assumes no dodging,
        so it under-rates a skilled player. Treat a narrow miss as “probably doable”.
      </div>

      <h2>Can we beat {speciesName(boss.speciesId)}?</h2>
      <div className="card verdict">
        {estimates.map((e) => (
          <div key={e.trainers} className={`verdict-row ${e.won ? 'win' : 'lose'}`}>
            <span className="label">{e.trainers === 1 ? 'Solo' : e.trainers === 2 ? 'Duo' : 'Trio'}</span>
            {e.won ? (
              <>
                <span className="bar"><span style={{ width: '100%' }} /></span>
                <span className="mono">Win in {formatSeconds(e.timeToWinMs!)}</span>
              </>
            ) : (
              <>
                <span className="bar"><span style={{ width: `${Math.round(e.bossHpFraction * 100)}%` }} /></span>
                <span className="mono">{Math.round(e.bossHpFraction * 100)}% of its HP</span>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="small muted">
        Assumes every trainer brings a party like yours. Your best {Math.min(PARTY_SIZE, roster.length)} deal{' '}
        <strong className="mono">{Math.round(sim.dps)}</strong> DPS over the {sim.timerMs / 1000}s timer,
        with {sim.deaths} faint{sim.deaths === 1 ? '' : 's'}.
      </p>

      <h2>Best attackers</h2>
      <div className="card scroll-x">
        <table className="results-table">
          <thead>
            <tr>
              <th>Pokémon</th>
              <th>DPS</th>
              <th>TDO</th>
              <th>Survives</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={`${r.speciesId}-${r.fastMove}-${i}`}>
                <td>
                  <div>{speciesName(r.speciesId)}</div>
                  <div className="small muted">{moveName(r.fastMove)} · {moveName(r.chargedMove)}</div>
                </td>
                <td className="mono">{r.dps.toFixed(1)}</td>
                <td className="mono">{Math.round(r.tdo)}</td>
                <td className="mono">{Math.round(r.survivalSeconds)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        DPS is damage per second while alive; TDO is total damage before fainting.
        A glass cannon can out-DPS a bulky attacker and still contribute less.
      </p>
      <p className="small muted">
        <strong>Check the movesets.</strong> New entries default to a good
        all-round moveset, not the best one against this particular boss, and
        never to an Elite-TM-only move. If a Pokémon here knows something
        better, set it on the Roster tab — it can swing DPS by half.
      </p>
    </>
  );
}
