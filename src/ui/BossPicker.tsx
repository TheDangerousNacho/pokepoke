import bossData from '../data/bosses.json';
import { getSpecies } from '../engine/gamemaster';
import { getTier, type RaidTier } from '../engine/raidTiers';
import type { RaidBossSpec } from '../engine/stats';
import { moveName, speciesName } from './format';
import { TypeChip } from './TypeChip';

export interface BossListEntry extends RaidBossSpec {
  shiny?: boolean;
}

export const BOSSES = (bossData.bosses as Array<{
  speciesId: string; tier: string; shiny: boolean; fastMove: string; chargedMove: string; megaId?: string;
}>).map((b) => ({ ...b, tier: b.tier as RaidTier })) as BossListEntry[];

export const BOSS_LIST_FETCHED_AT = bossData.fetchedAt;

const TIER_ORDER: RaidTier[] = ['1', '3', '4', '5', '6', 'MEGA', 'MEGA_LEGENDARY', 'ELITE', 'SHADOW_3', 'SHADOW_5'];

const TIER_LABEL: Record<RaidTier, string> = {
  '1': 'Tier 1', '3': 'Tier 3', '4': 'Tier 4', '5': 'Tier 5', '6': 'Tier 6',
  MEGA: 'Mega', MEGA_LEGENDARY: 'Mega Legendary', ELITE: 'Elite',
  SHADOW_3: 'Shadow T3', SHADOW_5: 'Shadow T5',
};

interface Props {
  selected: BossListEntry | null;
  onSelect: (boss: BossListEntry) => void;
  onChangeMoves: (boss: BossListEntry) => void;
}

export function BossPicker({ selected, onSelect, onChangeMoves }: Props) {
  const grouped = TIER_ORDER
    .map((tier) => ({ tier, bosses: BOSSES.filter((b) => b.tier === tier) }))
    .filter((g) => g.bosses.length > 0);

  const isSelected = (b: BossListEntry) =>
    selected?.speciesId === b.speciesId && selected?.tier === b.tier;

  return (
    <>
      <h2>Current raid bosses</h2>
      <p className="small muted" style={{ marginTop: -4 }}>
        Rotation fetched {new Date(BOSS_LIST_FETCHED_AT).toLocaleDateString()}.
        Refresh with <code>npm run fetch:bosses</code>.
      </p>

      {grouped.map(({ tier, bosses }) => (
        <section key={tier}>
          <h2>{TIER_LABEL[tier]} · {getTier(tier).bossHp.toLocaleString()} HP · {getTier(tier).timerSeconds}s</h2>
          <div className="boss-list">
            {bosses.map((b) => (
              <button
                key={`${b.tier}-${b.speciesId}`}
                className="boss card"
                aria-pressed={isSelected(b)}
                onClick={() => onSelect(b)}
              >
                <span className="grow">
                  <strong>{speciesName(b.speciesId)}</strong>
                  <span className="types" style={{ marginTop: 4 }}>
                    {getSpecies(b.speciesId).types.map((t) => (
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

      {selected && <BossMoveset boss={selected} onChange={onChangeMoves} />}
    </>
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
      <h3>{speciesName(boss.speciesId)}'s moveset</h3>
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
