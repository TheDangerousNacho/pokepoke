import { useMemo, useState } from 'react';
import type { BattleConditions } from '../engine/damage';
import { identicalLobby, simulateLobby, type LobbyTrainer } from '../engine/lobby';
import { rankAttackers } from '../engine/simulate';
import type { RosterEntry } from '../engine/stats';
import { partyMembers, type TrainerProfile } from '../storage/profiles';
import type { BossListEntry } from './BossPicker';
import { formatSeconds, moveName, speciesName } from './format';

interface Props {
  boss: BossListEntry | null;
  profiles: TrainerProfile[];
  activeProfileId: string;
  conditions: BattleConditions;
}

/** The six highest-DPS Pokémon are what someone would actually bring. */
const PARTY_SIZE = 6;

/** Picks a trainer's best six against this boss. */
function bestParty(roster: RosterEntry[], boss: BossListEntry, conditions: BattleConditions): RosterEntry[] {
  return rankAttackers(roster, boss, { conditions })
    .slice(0, PARTY_SIZE)
    .map((r) => roster.find((e) => e.speciesId === r.speciesId && e.fastMove === r.fastMove)!)
    .filter(Boolean);
}

/** Sentinel for "let the app pick", as opposed to a saved party's id. */
const AUTO = 'auto';

export function Results({ boss, profiles, activeProfileId, conditions }: Props) {
  const withRosters = profiles.filter((p) => p.roster.length > 0);
  const [selected, setSelected] = useState<string[]>([activeProfileId]);
  /** profile id -> saved party id, or AUTO. */
  const [chosenParty, setChosenParty] = useState<Record<string, string>>({});

  const inLobby = withRosters.filter((p) => selected.includes(p.id));

  const result = useMemo(() => {
    if (!boss || inLobby.length === 0) return null;

    const parties = inLobby.map((p) => {
      const choice = chosenParty[p.id] ?? AUTO;
      const saved = choice === AUTO ? [] : partyMembers(p, choice);
      // Fall back to the automatic pick if a saved party has been emptied out
      // by deleting its members, rather than sending someone in with nothing.
      return {
        id: p.id,
        name: p.name,
        party: saved.length > 0 ? saved : bestParty(p.roster, boss, conditions),
      };
    }) satisfies LobbyTrainer[];

    // One trainer selected still means "could N people like me do this", so
    // the group estimate is copies of that party. Two or more means a real
    // lobby, and copying anyone would be inventing Pokémon they do not own.
    const groupEstimates =
      parties.length === 1
        ? [1, 2, 3].map((n) => ({
            n,
            lobby: simulateLobby(identicalLobby(parties[0].party, n, parties[0].name), boss, { conditions }),
          }))
        : null;

    return {
      parties,
      groupEstimates,
      lobby: simulateLobby(parties, boss, { conditions }),
      ranked: rankAttackers(inLobby.flatMap((p) => p.roster), boss, { conditions }),
    };
  }, [boss, inLobby.map((p) => p.id).join(','), chosenParty, profiles, conditions]);

  if (!boss) return <p className="empty">Pick a raid boss first.</p>;
  if (withRosters.length === 0) return <p className="empty">Add some Pokémon to a roster first.</p>;

  return (
    <>
      <div className="notice">
        <strong>Estimates, not guarantees.</strong> The simulation runs about 10%
        optimistic against Pokebattler and assumes nobody dodges. Treat a narrow
        win as a coin flip.
      </div>

      <h2>Who's raiding?</h2>
      <div className="card">
        {withRosters.map((p) => {
          const isIn = selected.includes(p.id);
          return (
            <div key={p.id} style={{ padding: '6px 0' }}>
              <label className="row">
                <input
                  type="checkbox"
                  checked={isIn}
                  onChange={(e) =>
                    setSelected((s) => (e.target.checked ? [...s, p.id] : s.filter((id) => id !== p.id)))
                  }
                  style={{ width: 18, height: 18 }}
                />
                <span className="grow">{p.name}</span>
                <span className="small muted">{p.roster.length} Pokémon</span>
              </label>
              {isIn && p.parties.length > 0 && (
                <select
                  style={{ marginTop: 6, width: '100%' }}
                  aria-label={`${p.name}'s party`}
                  value={chosenParty[p.id] ?? AUTO}
                  onChange={(e) => setChosenParty((c) => ({ ...c, [p.id]: e.target.value }))}
                >
                  <option value={AUTO}>Best 6 for this boss (automatic)</option>
                  {p.parties.map((party) => (
                    <option key={party.id} value={party.id}>{party.name}</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
        {withRosters.length === 1 && (
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Only one roster here. Add a profile per family member on the Roster
            tab and the estimate will use their actual Pokémon instead of
            assuming they bring a copy of yours.
          </p>
        )}
      </div>

      {!result || inLobby.length === 0 ? (
        <p className="empty">Select at least one trainer.</p>
      ) : (
        <>
          <h2>Can we beat {speciesName(boss.speciesId)}?</h2>

          {result.groupEstimates ? (
            <>
              <div className="card verdict">
                {result.groupEstimates.map(({ n, lobby }) => (
                  <Verdict
                    key={n}
                    label={n === 1 ? 'Solo' : n === 2 ? 'Duo' : 'Trio'}
                    won={lobby.won}
                    timeToWinMs={lobby.timeToWinMs}
                    fraction={lobby.bossHpFraction}
                  />
                ))}
              </div>
              <p className="small muted">
                Assumes every trainer brings a party like this one.
              </p>
            </>
          ) : (
            <>
              <div className="card verdict">
                <Verdict
                  label={`${result.parties.length} trainers`}
                  won={result.lobby.won}
                  timeToWinMs={result.lobby.timeToWinMs}
                  fraction={result.lobby.bossHpFraction}
                />
              </div>
              <h2>Who's pulling their weight</h2>
              <div className="card scroll-x">
                <table className="results-table">
                  <thead>
                    <tr><th>Trainer</th><th>Damage</th><th>Share</th><th>Faints</th></tr>
                  </thead>
                  <tbody>
                    {result.lobby.trainers.map((t) => (
                      <tr key={t.id}>
                        <td>{t.name}</td>
                        <td className="mono">{Math.round(t.sim.totalDamage).toLocaleString()}</td>
                        <td className="mono">{Math.round(t.share * 100)}%</td>
                        <td className="mono">{t.sim.deaths}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                Each trainer's own Pokémon, simulated separately — the boss
                attacks everyone independently, so this is the faithful model
                rather than a shortcut.
              </p>
            </>
          )}

          {result.lobby.megaBoostTypes.length > 0 && (
            <p className="small muted">
              Mega boost active ({result.lobby.megaBoostTypes.join(', ')}) — a mega
              in the lobby boosts everyone's damage, not just its owner's.
            </p>
          )}

          <h2>Best attackers</h2>
          <div className="card scroll-x">
            <table className="results-table">
              <thead>
                <tr><th>Pokémon</th><th>DPS</th><th>TDO</th><th>Survives</th></tr>
              </thead>
              <tbody>
                {result.ranked.slice(0, 12).map((r, i) => (
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
            <strong>Check the movesets.</strong> New entries default to a good
            all-round moveset, not the best one against this boss, and never to
            an Elite-TM-only move. Fix them on the Roster tab — it can swing DPS
            by half.
          </p>
        </>
      )}
    </>
  );
}

function Verdict({ label, won, timeToWinMs, fraction }: {
  label: string; won: boolean; timeToWinMs: number | null; fraction: number;
}) {
  return (
    <div className={`verdict-row ${won ? 'win' : 'lose'}`}>
      <span className="label">{label}</span>
      {won ? (
        <>
          <span className="bar"><span style={{ width: '100%' }} /></span>
          <span className="mono">Win in {formatSeconds(timeToWinMs!)}</span>
        </>
      ) : (
        <>
          <span className="bar"><span style={{ width: `${Math.round(fraction * 100)}%` }} /></span>
          <span className="mono">{Math.round(fraction * 100)}% of its HP</span>
        </>
      )}
    </div>
  );
}
