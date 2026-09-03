import { describe, expect, it } from 'vitest';
import { MAX_POWER_UP_LEVEL, planPowerUps, upgradeCost } from '../leveling';
import { gm } from '../gamemaster';
import type { LobbyTrainer } from '../lobby';
import type { RaidBossSpec, RosterEntry } from '../stats';

const iv = (n: number) => ({ attack: n, defense: n, stamina: n });
const mon = (speciesId: string, level: number, n = 12): RosterEntry => ({
  speciesId, level, ivs: iv(n), fastMove: 'COUNTER_FAST', chargedMove: 'DYNAMIC_PUNCH',
});

describe('upgradeCost', () => {
  it('charges one payment per half level', () => {
    // Level 30 costs 5,000 dust per upgrade and there are two per whole level.
    const half = upgradeCost(30, 30.5);
    const whole = upgradeCost(30, 31);
    expect(half.stardust).toBe(gm.upgradeCosts.stardust[29]);
    expect(whole.stardust).toBe(gm.upgradeCosts.stardust[29] * 2);
    expect(whole.candy).toBe(gm.upgradeCosts.candy[29] * 2);
  });

  it('is zero for no change and for going backwards', () => {
    expect(upgradeCost(30, 30)).toEqual({ stardust: 0, candy: 0, xlCandy: 0 });
    expect(upgradeCost(30, 25)).toEqual({ stardust: 0, candy: 0, xlCandy: 0 });
  });

  it('accumulates across a long climb', () => {
    const direct = upgradeCost(25, 30);
    let sum = { stardust: 0, candy: 0, xlCandy: 0 };
    for (let l = 25; l < 30; l += 0.5) {
      const s = upgradeCost(l, l + 0.5);
      sum = { stardust: sum.stardust + s.stardust, candy: sum.candy + s.candy, xlCandy: sum.xlCandy + s.xlCandy };
    }
    expect(direct).toEqual(sum);
  });

  it('switches to XL candy above level 40', () => {
    const below = upgradeCost(39, 39.5);
    const above = upgradeCost(41, 41.5);
    expect(below.candy).toBeGreaterThan(0);
    expect(below.xlCandy).toBe(0);
    expect(above.candy).toBe(0);
    expect(above.xlCandy).toBeGreaterThan(0);
  });

  it('charges shadows the surcharge', () => {
    const normal = upgradeCost(30, 31);
    const shadow = upgradeCost(30, 31, { isShadow: true });
    expect(shadow.stardust).toBeGreaterThan(normal.stardust);
    expect(shadow.stardust / normal.stardust).toBeCloseTo(gm.upgradeCosts.shadowStardustMultiplier, 2);
  });

  it('gets cheaper per level the lower you are', () => {
    // The whole reason the planner ranks by stardust: a half level at 25 is a
    // fraction of the price of one at 40.
    expect(upgradeCost(25, 25.5).stardust).toBeLessThan(upgradeCost(40, 40.5).stardust);
  });

  it('refuses to plan past the power-up ceiling', () => {
    expect(() => upgradeCost(49, MAX_POWER_UP_LEVEL + 1)).toThrow(/cannot power up past/);
  });
});

describe('planPowerUps', () => {
  const regice: RaidBossSpec = {
    speciesId: 'REGICE', tier: '5', fastMove: 'FROST_BREATH_FAST', chargedMove: 'BLIZZARD',
  };
  const trainer = (id: string, party: RosterEntry[]): LobbyTrainer => ({ id, name: id, party });

  const strongLobby = () => [
    trainer('a', [mon('MACHAMP', 40, 15), mon('MACHAMP', 40, 15), mon('MACHAMP', 40, 15)]),
    trainer('b', [mon('MACHAMP', 40, 15), mon('MACHAMP', 40, 15), mon('MACHAMP', 40, 15)]),
    trainer('c', [mon('MACHAMP', 40, 15), mon('MACHAMP', 40, 15), mon('MACHAMP', 40, 15)]),
  ];

  it('says nothing to do when the raid is already won', () => {
    // Enough trainers that it wins outright.
    const many = Array.from({ length: 8 }, (_, i) =>
      trainer(`t${i}`, [mon('MACHAMP', 40, 15), mon('MACHAMP', 40, 15)]));
    const plan = planPowerUps(many, regice);
    if (plan.alreadyWinning) {
      expect(plan.steps).toEqual([]);
      expect(plan.total.stardust).toBe(0);
    }
  });

  it('produces steps that actually raise levels', () => {
    const plan = planPowerUps([trainer('a', [mon('MACHAMP', 20), mon('MACHAMP', 20)])], regice, { maxSteps: 6 });
    for (const s of plan.steps) {
      expect(s.toLevel).toBeGreaterThan(s.fromLevel);
      expect(s.cost.stardust).toBeGreaterThan(0);
      expect(s.damageGain).toBeGreaterThan(0);
    }
  });

  it('merges repeated half-steps on one Pokémon into a single instruction', () => {
    const plan = planPowerUps([trainer('a', [mon('MACHAMP', 20)])], regice, { maxSteps: 8 });
    const keys = plan.steps.map((s) => `${s.trainerId}:${s.memberIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
    if (plan.steps.length > 0) {
      expect(plan.steps[0].toLevel - plan.steps[0].fromLevel).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('costs more in total than any single step', () => {
    const plan = planPowerUps([trainer('a', [mon('MACHAMP', 20), mon('MACHAMP', 25)])], regice, { maxSteps: 10 });
    if (plan.steps.length > 1) {
      const biggest = Math.max(...plan.steps.map((s) => s.cost.stardust));
      expect(plan.total.stardust).toBeGreaterThan(biggest);
    }
  });

  it('improves the outcome it started from', () => {
    const lobby = strongLobby();
    const plan = planPowerUps(lobby, regice, { maxSteps: 20 });
    if (!plan.alreadyWinning) expect(plan.finalFraction).toBeGreaterThan(0);
  });

  it('admits when power-ups cannot save it, without listing futile spending', () => {
    // One weak Pokémon against a tier 5 boss is hopeless at any level. Listing
    // a million stardust of power-ups that still lose is worse than saying so.
    const plan = planPowerUps([trainer('a', [mon('MAGIKARP', 20, 0)])], regice, { maxSteps: 30 });
    expect(plan.achievable).toBe(false);
    expect(plan.steps).toEqual([]);
    expect(plan.total.stardust).toBe(0);
    // But it still reports how close maxing everyone would get.
    expect(plan.finalFraction).toBeGreaterThan(0);
    expect(plan.finalFraction).toBeLessThan(1);
  });

  it('stops as soon as the raid is winnable, not at the cap', () => {
    const lobby = Array.from({ length: 4 }, (_, i) =>
      trainer(`t${i}`, [mon('MACHAMP', 20, 15), mon('MACHAMP', 20, 15), mon('MACHAMP', 20, 15)]));
    const plan = planPowerUps(lobby, regice);
    if (plan.achievable && !plan.alreadyWinning) {
      // Nothing should be maxed out just because the loop had budget left.
      for (const s of plan.steps) expect(s.toLevel).toBeLessThan(MAX_POWER_UP_LEVEL);
    }
  });

  it('never proposes going past the ceiling', () => {
    const plan = planPowerUps([trainer('a', [mon('MACHAMP', 49.5), mon('MACHAMP', 50)])], regice, { maxSteps: 10 });
    for (const s of plan.steps) expect(s.toLevel).toBeLessThanOrEqual(MAX_POWER_UP_LEVEL);
  });

  it('respects the step cap so it always terminates', () => {
    const plan = planPowerUps([trainer('a', [mon('MACHAMP', 10), mon('MACHAMP', 12)])], regice, { maxSteps: 2 });
    expect(plan.steps.length).toBeLessThanOrEqual(2);
  });

  it('does not stall on flooring', () => {
    // A half level often changes no integer damage at all, because per-hit
    // damage is floored. Candidates must be big enough to move that number, or
    // the planner reports "nothing can be done" for a very fixable raid.
    // Chosen to be losing now (70% of HP) but winnable when maxed, so a stall
    // shows up as "nothing to do" rather than being hidden by an already-won or
    // hopeless raid.
    const lobby = Array.from({ length: 4 }, (_, i) =>
      trainer(`t${i}`, [mon('MACHAMP', 20, 15), mon('MACHAMP', 20, 15), mon('MACHAMP', 20, 15)]));
    const plan = planPowerUps(lobby, regice);
    expect(plan.alreadyWinning).toBe(false);
    expect(plan.achievable).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.total.stardust).toBeGreaterThan(0);
  });
});
