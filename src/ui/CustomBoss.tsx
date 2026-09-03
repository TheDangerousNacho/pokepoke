import { useState } from 'react';
import { getSpecies } from '../engine/gamemaster';
import { getTier, type RaidTier } from '../engine/raidTiers';
import type { BossListEntry } from './BossPicker';
import { buildCustomBoss, MEGA_TIERS } from './customBossSpec';
import { megaName, speciesName } from './format';
import { SpeciesPicker } from './SpeciesPicker';
import { TypeChip } from './TypeChip';

interface Props {
  selected: BossListEntry | null;
  onSelect: (boss: BossListEntry) => void;
}

/**
 * Tiers a custom boss can be built at, in the order they are worth planning
 * for. Mega tiers are here too because the mega rotation moves faster than
 * anything else.
 */
const TIERS: Array<[RaidTier, string]> = [
  ['5', 'Tier 5'],
  ['6', 'Tier 6'],
  ['MEGA', 'Mega'],
  ['MEGA_LEGENDARY', 'Mega Legendary'],
  ['SHADOW_5', 'Shadow T5'],
  ['3', 'Tier 3'],
  ['SHADOW_3', 'Shadow T3'],
  ['1', 'Tier 1'],
];

/**
 * Bosses the rotation feed does not know about yet — a legendary announced for
 * next month, or one someone in the group is asking about. The rotation only
 * answers "what can we fight tonight"; this answers "what should we build".
 *
 * The moveset defaults the way the rotation feed does, and is adjustable
 * below like any other boss.
 */
export function CustomBoss({ selected, onSelect }: Props) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<RaidTier>('5');

  const custom = selected?.custom ? selected : null;

  const pick = (speciesId: string) => {
    const boss = buildCustomBoss(speciesId, custom?.tier ?? tier);
    setPicking(false);
    if (boss) onSelect(boss);
    else setError(speciesName(speciesId));
  };

  const species = custom ? getSpecies(custom.speciesId) : null;

  if (picking) {
    return (
      <section>
        <h2>Which Pokémon?</h2>
        <SpeciesPicker onPick={pick} onCancel={() => setPicking(false)} />
      </section>
    );
  }

  return (
    <section>
      <h2>Another boss</h2>
      {custom && species ? (
        <div className="card">
          <div className="row spread">
            <span className="grow">
              <strong>{speciesName(custom.speciesId)}</strong>
              {custom.megaId && <span className="small muted"> · {megaName(custom.megaId)}</span>}
              <span className="types" style={{ marginTop: 4 }}>
                {(custom.megaId
                  ? species.megas.find((m) => m.id === custom.megaId)!.types
                  : species.types
                ).map((t) => <TypeChip key={t} type={t} />)}
              </span>
            </span>
            <button onClick={() => setPicking(true)}>Change</button>
          </div>

          <div className="grid-2" style={{ marginTop: 10 }}>
            <div className="field">
              <label htmlFor="custom-tier">Tier</label>
              <select
                id="custom-tier"
                value={custom.tier}
                onChange={(e) => {
                  const next = e.target.value as RaidTier;
                  setTier(next);
                  const boss = buildCustomBoss(custom.speciesId, next);
                  if (boss) onSelect(boss);
                }}
              >
                {TIERS.map(([t, label]) => (
                  <option key={t} value={t}>
                    {label} · {getTier(t).bossHp.toLocaleString()} HP
                  </option>
                ))}
              </select>
            </div>

            {species.megas.length > 1 && MEGA_TIERS.includes(custom.tier) && (
              <div className="field">
                <label htmlFor="custom-mega">Form</label>
                <select
                  id="custom-mega"
                  value={custom.megaId ?? species.megas[0].id}
                  onChange={(e) => {
                    const boss = buildCustomBoss(custom.speciesId, custom.tier, e.target.value);
                    if (boss) onSelect(boss);
                  }}
                >
                  {species.megas.map((m) => (
                    <option key={m.id} value={m.id}>{megaName(m.id)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Not from the rotation, so the tier is your call — a boss's tier is
            what sets its HP and the battle timer, and the app has no way to
            know it before the raid goes live.
          </p>
        </div>
      ) : (
        <div className="card">
          <p style={{ margin: 0 }}>
            Planning ahead for something not in the rotation? Pick any Pokémon
            and a tier.
          </p>
          {error && (
            <p className="small" style={{ margin: '8px 0 0', color: 'var(--bad)' }}>
              {error} has no usable moveset in the Game Master, so it can't be
              simulated as a boss.
            </p>
          )}
          <button className="primary" style={{ marginTop: 10 }} onClick={() => { setError(null); setPicking(true); }}>
            Build a custom boss
          </button>
        </div>
      )}
    </section>
  );
}
