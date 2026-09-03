import { describe, expect, it } from 'vitest';
import { findBenchGaps } from '../bench';
import { getSpecies } from '../gamemaster';
import type { RaidBossSpec, RosterEntry } from '../stats';

const entry = (speciesId: string, fastMove: string, chargedMove: string, level = 40): RosterEntry => ({
  speciesId, level, ivs: { attack: 15, defense: 15, stamina: 15 }, fastMove, chargedMove,
});

/** A Steel/Psychic tier 5 boss: weak to Fire, Ground, Dark and Ghost. */
const METAGROSS_BOSS: RaidBossSpec = {
  speciesId: 'METAGROSS', tier: '5', fastMove: 'BULLET_PUNCH_FAST', chargedMove: 'METEOR_MASH',
};

const ROSTER = [
  entry('METAGROSS', 'BULLET_PUNCH_FAST', 'METEOR_MASH'),
  entry('MACHAMP', 'COUNTER_FAST', 'DYNAMIC_PUNCH'),
];

describe('findBenchGaps', () => {
  it('never names a Mythical, which cannot be farmed', () => {
    const gaps = findBenchGaps(ROSTER, [METAGROSS_BOSS]);
    for (const c of gaps[0].candidates) {
      expect(getSpecies(c.speciesId).rarity).not.toBe('MYTHIC');
    }
  });

  it('measures coverage against a farmable species, not a legendary', () => {
    const [gap] = findBenchGaps(ROSTER, [METAGROSS_BOSS]);
    const withCounter = findBenchGaps([...ROSTER, entry('CHANDELURE', 'FIRE_SPIN_FAST', 'OVERHEAT')], [METAGROSS_BOSS]);
    expect(withCounter[0].coverage).toBeGreaterThan(gap.coverage);

    // Owning the best farmable counter itself must read as full coverage,
    // which is what makes the number mean "as good as this fight gets for an
    // ordinary bench" rather than "do you own a legendary".
    const bestFarmable = findBenchGaps([], [METAGROSS_BOSS])[0]
      .candidates.find((c) => c.rarity === 'NORMAL')!;
    const owningIt = findBenchGaps(
      [entry(bestFarmable.speciesId, bestFarmable.fastMove, bestFarmable.chargedMove)],
      [METAGROSS_BOSS],
    );
    expect(owningIt[0].coverage).toBe(1);
  });

  it('only suggests what beats your own best', () => {
    const [gap] = findBenchGaps(ROSTER, [METAGROSS_BOSS]);
    expect(gap.best).not.toBeNull();
    for (const c of gap.candidates) expect(c.dps).toBeGreaterThan(gap.best!.dps);
  });

  it('offers something farmable, not only raid legendaries', () => {
    const [gap] = findBenchGaps(ROSTER, [METAGROSS_BOSS]);
    expect(gap.candidates.some((c) => c.rarity === 'NORMAL')).toBe(true);
  });

  it('flags a candidate the roster already has, so it says power up not catch', () => {
    const top = findBenchGaps([], [METAGROSS_BOSS])[0].candidates[0];
    const underlevelled = [entry(top.speciesId, top.fastMove, top.chargedMove, 10)];
    const [gap] = findBenchGaps(underlevelled, [METAGROSS_BOSS]);
    expect(gap.candidates.find((c) => c.speciesId === top.speciesId)?.owned).toBe(true);
  });

  it('leaves out battle-only forms the game never hands out', () => {
    const gaps = findBenchGaps(ROSTER, [METAGROSS_BOSS]);
    for (const c of gaps[0].candidates) expect(c.speciesId).not.toBe('DARMANITAN_GALARIAN_ZEN');
  });

  it('sorts the worst-covered fight first', () => {
    const bosses: RaidBossSpec[] = [
      METAGROSS_BOSS,
      { speciesId: 'MACHAMP', tier: '3', fastMove: 'COUNTER_FAST', chargedMove: 'DYNAMIC_PUNCH' },
    ];
    const gaps = findBenchGaps(ROSTER, bosses);
    expect(gaps[0].coverage).toBeLessThanOrEqual(gaps[1].coverage);
  });

  it('handles an empty roster without claiming coverage', () => {
    const [gap] = findBenchGaps([], [METAGROSS_BOSS]);
    expect(gap.best).toBeNull();
    expect(gap.coverage).toBe(0);
    expect(gap.candidates.length).toBeGreaterThan(0);
  });
});
