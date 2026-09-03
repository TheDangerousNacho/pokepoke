import { describe, expect, it } from 'vitest';
import { rankAttackers, rateAttacker, simulateParty, timeToWin } from '../simulate';
import type { RaidBossSpec, RosterEntry } from '../stats';
import { getTier } from '../raidTiers';

const ivs = { attack: 15, defense: 15, stamina: 15 };
const mon = (speciesId: string, fastMove: string, chargedMove: string, extra: Partial<RosterEntry> = {}): RosterEntry => ({
  speciesId, level: 40, ivs, fastMove, chargedMove, ...extra,
});

const machamp = mon('MACHAMP', 'COUNTER_FAST', 'DYNAMIC_PUNCH');
const tyranitar = mon('TYRANITAR', 'BITE_FAST', 'CRUNCH');
const metagross = mon('METAGROSS', 'BULLET_PUNCH_FAST', 'METEOR_MASH');
const magikarp = mon('MAGIKARP', 'SPLASH_FAST', 'STRUGGLE');

const mewtwo: RaidBossSpec = { speciesId: 'MEWTWO', tier: '5', fastMove: 'PSYCHO_CUT_FAST', chargedMove: 'PSYSTRIKE' };
const t1 = (speciesId: string): RaidBossSpec => ({ speciesId, tier: '1', fastMove: 'TACKLE_FAST', chargedMove: 'BODY_SLAM' });

describe('simulateParty', () => {
  it('runs for the full tier timer and never past it', () => {
    const sim = simulateParty([machamp], mewtwo);
    expect(sim.timerMs).toBe(getTier('5').timerSeconds * 1000);
    expect(sim.samples.at(-1)!.timeMs).toBe(sim.timerMs);
    for (const s of sim.samples) expect(s.timeMs).toBeLessThanOrEqual(sim.timerMs);
  });

  it('produces a monotonically increasing damage curve', () => {
    const sim = simulateParty([tyranitar], mewtwo);
    let prev = -1;
    for (const s of sim.samples) {
      expect(s.cumulativeDamage).toBeGreaterThanOrEqual(prev);
      prev = s.cumulativeDamage;
    }
    expect(sim.totalDamage).toBe(sim.samples.at(-1)!.cumulativeDamage);
  });

  it('deals more damage with a better-matched attacker', () => {
    // Tyranitar's Dark moves are super effective on Mewtwo; Machamp's Fighting
    // moves are resisted.
    const good = simulateParty([tyranitar], mewtwo).totalDamage;
    const bad = simulateParty([machamp], mewtwo).totalDamage;
    expect(good).toBeGreaterThan(bad);
  });

  it('deals essentially no damage with a useless attacker', () => {
    const sim = simulateParty([magikarp], mewtwo);
    expect(sim.totalDamage).toBeLessThan(simulateParty([tyranitar], mewtwo).totalDamage / 10);
  });

  it('a deeper bench survives longer and so deals more damage', () => {
    const one = simulateParty([tyranitar], mewtwo);
    const six = simulateParty([tyranitar, tyranitar, tyranitar, tyranitar, tyranitar, tyranitar], mewtwo);
    expect(six.totalDamage).toBeGreaterThan(one.totalDamage);
    expect(six.deaths).toBeGreaterThanOrEqual(one.deaths);
  });

  it('charges up and fires charged moves', () => {
    // A run with no charged move available should do strictly less damage.
    const withCharged = simulateParty([tyranitar], mewtwo).totalDamage;
    const fastOnly = simulateParty([mon('TYRANITAR', 'BITE_FAST', 'HYPER_BEAM')], mewtwo).totalDamage;
    expect(withCharged).not.toBe(fastOnly);
  });

  it('applies weather to the whole run', () => {
    const plain = simulateParty([tyranitar], mewtwo).totalDamage;
    const boosted = simulateParty([tyranitar], mewtwo, { conditions: { weather: 'FOG' } }).totalDamage;
    expect(boosted).toBeGreaterThan(plain);
  });

  it('rejects an empty party', () => {
    expect(() => simulateParty([], mewtwo)).toThrow(/empty/);
  });

  it('costs time when the whole party wipes', () => {
    const quick = simulateParty([magikarp], mewtwo, { relobbyMs: 1000 });
    const slow = simulateParty([magikarp], mewtwo, { relobbyMs: 60_000 });
    expect(quick.deaths).toBeGreaterThan(slow.deaths);
  });

  it('a shorter reaction delay means more damage', () => {
    const slow = simulateParty([tyranitar], mewtwo, { attackDelayMs: 2000 }).totalDamage;
    const fast = simulateParty([tyranitar], mewtwo, { attackDelayMs: 0 }).totalDamage;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('timeToWin', () => {
  it('solos a tier 1 boss with a strong attacker', () => {
    const sim = simulateParty([tyranitar], t1('BULBASAUR'));
    const solo = timeToWin(sim, 1);
    expect(solo.won).toBe(true);
    expect(solo.timeToWinMs).toBeGreaterThan(0);
    expect(solo.timeToWinMs).toBeLessThanOrEqual(sim.timerMs);
  });

  it('reports a loss with the fraction of HP removed', () => {
    const sim = simulateParty([magikarp], mewtwo);
    const solo = timeToWin(sim, 1);
    expect(solo.won).toBe(false);
    expect(solo.timeToWinMs).toBeNull();
    expect(solo.bossHpFraction).toBeGreaterThan(0);
    expect(solo.bossHpFraction).toBeLessThan(1);
  });

  it('more trainers never take longer', () => {
    const sim = simulateParty([tyranitar, metagross, machamp], mewtwo);
    const times = [1, 2, 3, 4].map((n) => timeToWin(sim, n));
    const finished = times.filter((r) => r.won).map((r) => r.timeToWinMs!);
    for (let i = 1; i < finished.length; i++) {
      expect(finished[i]).toBeLessThanOrEqual(finished[i - 1]);
    }
  });

  it('scales the HP fraction with the number of trainers', () => {
    const sim = simulateParty([magikarp], mewtwo);
    expect(timeToWin(sim, 2).bossHpFraction).toBeCloseTo(timeToWin(sim, 1).bossHpFraction * 2, 6);
  });

  it('rejects a nonsensical group size', () => {
    const sim = simulateParty([tyranitar], mewtwo);
    expect(() => timeToWin(sim, 0)).toThrow(/at least 1/);
  });
});

describe('rateAttacker', () => {
  it('reports dps, tdo and survival together', () => {
    const r = rateAttacker(tyranitar, mewtwo);
    expect(r.dps).toBeGreaterThan(0);
    expect(r.tdo).toBeGreaterThan(0);
    expect(r.survivalSeconds).toBeGreaterThan(0);
    expect(r.name).toBe('TYRANITAR');
  });

  it('ranks a super-effective attacker above a resisted one', () => {
    const ranked = rankAttackers([machamp, tyranitar, magikarp], mewtwo);
    expect(ranked.map((r) => r.speciesId)).toEqual(['TYRANITAR', 'MACHAMP', 'MAGIKARP']);
    expect(ranked[0].dps).toBeGreaterThan(ranked[1].dps);
  });

  it('rates a shadow above its non-shadow twin', () => {
    const normal = rateAttacker(tyranitar, mewtwo);
    const shadow = rateAttacker({ ...tyranitar, isShadow: true }, mewtwo);
    expect(shadow.dps).toBeGreaterThan(normal.dps);
    // The shadow is frailer, so it should not also survive longer.
    expect(shadow.survivalSeconds).toBeLessThanOrEqual(normal.survivalSeconds);
  });
});
