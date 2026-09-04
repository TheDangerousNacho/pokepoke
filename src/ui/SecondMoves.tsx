import type { BattleConditions } from '../engine/damage';
import { rankSecondMoves, type SecondMoveRecommendation } from '../engine/secondMove';
import type { RaidBossSpec, RosterEntry } from '../engine/stats';
import { bossName, moveName, speciesName } from './format';
import { useDeferredCompute } from './useDeferredCompute';

/** Best value first, so a longer list is a worse list. Six is a decision; a
 *  ranked twenty is a spreadsheet. */
const SHOWN = 6;

interface Props {
  roster: RosterEntry[];
  bosses: RaidBossSpec[];
  conditions: BattleConditions;
}

/**
 * Whether to spend stardust on a second charged move.
 *
 * Sits between the TM advice and the bench gaps because it is the middle
 * rung of the same ladder: change a move you have, add one to a Pokémon you
 * have, or go and get a different Pokémon.
 */
export function SecondMoves({ roster, bosses, conditions }: Props) {
  const { value: picks, pending } = useDeferredCompute(
    () => (roster.length > 0 && bosses.length > 0 ? rankSecondMoves(roster, bosses, { conditions }) : []),
    [roster, bosses, conditions],
  );

  return (
    <>
      <h2>Worth a second charged move?{pending && <span className="small muted"> · updating…</span>}</h2>

      {!picks ? (
        <p className="empty">Pricing every pair…</p>
      ) : picks.length === 0 ? (
        <p className="empty">
          Nobody here would use a second move enough to justify the dust — one
          move already covers these bosses.
        </p>
      ) : (
        picks.slice(0, SHOWN).map((p) => <SecondMoveCard key={`${p.speciesId}-${p.primary}`} pick={p} />)
      )}

      {picks && picks.length > SHOWN && (
        <p className="small muted">
          {picks.length - SHOWN} more would pay off too, ranked below these.
        </p>
      )}

      <p className="small muted">
        A second move is not extra damage — you would just use the better one.
        It is worth dust when the same Pokémon becomes the right answer to more
        of the rotation, so that coverage is what is measured, against the best
        <em> single</em> move rather than the one currently equipped: an unlock
        has to beat the cheaper TM, not just beat doing nothing.
      </p>
    </>
  );
}

function SecondMoveCard({ pick }: { pick: SecondMoveRecommendation }) {
  return (
    <div className="card">
      <div className="spread">
        <h3>{speciesName(pick.speciesId)}</h3>
        <span className="tier" style={{ color: 'var(--good)', borderColor: 'var(--good)' }}>
          +{Math.round(pick.gain * 100)}% DPS
        </span>
      </div>

      <table className="results-table" style={{ marginTop: 4 }}>
        <tbody>
          <tr>
            <td style={{ borderTop: 'none' }}>
              <div className="small muted">Best single move</div>
              <div>{moveName(pick.fastMove)} · {moveName(pick.primary)}</div>
            </td>
            <td className="mono" style={{ borderTop: 'none' }}>{pick.singleDps.toFixed(1)}</td>
          </tr>
          <tr>
            <td>
              <div className="small muted">
                Add {moveName(pick.addition)} · {pick.cost.stardust.toLocaleString()} dust,{' '}
                {pick.cost.candy} candy
              </div>
              <div>
                <strong>{moveName(pick.primary)} + {moveName(pick.addition)}</strong>
              </div>
            </td>
            <td className="mono"><strong>{pick.pairDps.toFixed(1)}</strong></td>
          </tr>
        </tbody>
      </table>

      {pick.helpsAgainst.length > 0 && (
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          {moveName(pick.addition)} is the move you'd fire against{' '}
          {pick.helpsAgainst.map(bossName).join(', ')}.
        </p>
      )}

      {pick.needsTmFirst && (
        <p className="small" style={{ color: 'var(--warn)', margin: '8px 0 0' }}>
          This assumes {moveName(pick.primary)} in the first slot — a TM away
          from what it knows now.
        </p>
      )}
    </div>
  );
}
