import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/pokebattler.json';
import { simulateParty } from '../simulate';
import { getTier, type RaidTier } from '../raidTiers';
import type { RaidBossSpec, RosterEntry } from '../stats';

/**
 * Cross-validation against Pokebattler — the only independent raid simulator
 * we can compare against.
 *
 * This is NOT an equality test and cannot be one. Pokebattler runs a Monte
 * Carlo over randomised boss movesets with a dodge model this engine omits by
 * design. What the comparison catches is a *systematic* error — a wrong
 * constant, an off-by-one in the energy loop, a bad tier value — which shows
 * up as the ratio moving or spreading, not as any single matchup being off.
 *
 * Measured behaviour as of the fixture set (30 matchups, 5 bosses, 3 tiers):
 *
 *   overall  mean 0.898, range 0.81-1.01
 *   tier 1   mean 0.870
 *   tier 3   mean 0.955
 *   tier 5   mean 0.888
 *
 * We are consistently ~11% OPTIMISTIC: we say fewer trainers are needed than
 * Pokebattler does. That direction is expected and explainable — this engine
 * assumes zero input delay between moves, so its DPS is a clean ceiling that
 * no real player quite reaches. It has deliberately NOT been tuned to close
 * the gap; inventing a delay constant to match someone else's output would
 * make the agreement meaningless.
 *
 * The bounds below pin that measured behaviour so a regression moves them.
 */

const ivs = { attack: 15, defense: 15, stamina: 15 };

/** Each boss's own moveset. Only affects how fast our attackers faint. */
const BOSS_MOVES: Record<string, { fastMove: string; chargedMove: string }> = {
  REGICE: { fastMove: 'FROST_BREATH_FAST', chargedMove: 'BLIZZARD' },
  REGIROCK: { fastMove: 'ROCK_THROW_FAST', chargedMove: 'STONE_EDGE' },
  REGISTEEL: { fastMove: 'METAL_CLAW_FAST', chargedMove: 'FLASH_CANNON' },
  DRATINI: { fastMove: 'DRAGON_BREATH_FAST', chargedMove: 'WRAP' },
  PASSIMIAN: { fastMove: 'COUNTER_FAST', chargedMove: 'CLOSE_COMBAT' },
};

/** Trainers needed, in the same sense as Pokebattler's `estimator`. */
function trainersNeeded(attacker: RosterEntry, boss: RaidBossSpec): number {
  const sim = simulateParty(Array<RosterEntry>(6).fill(attacker), boss);
  return getTier(boss.tier).bossHp / sim.totalDamage;
}

const results = fixtures.fixtures.map((f) => {
  const moves = BOSS_MOVES[f.boss];
  if (!moves) throw new Error(`no boss moveset recorded for ${f.boss}`);
  const ours = trainersNeeded(
    {
      speciesId: f.attacker,
      level: 40,
      ivs,
      fastMove: f.fastMove,
      chargedMove: f.chargedMove,
      isShadow: f.isShadow,
    },
    { speciesId: f.boss, tier: f.tier as RaidTier, ...moves },
  );
  return { ...f, ours, ratio: ours / f.estimator };
});

describe('agreement with Pokebattler', () => {
  it.each(results)('$attacker ($fastMove/$chargedMove) vs $boss', ({ ours, ratio }) => {
    expect(ours).toBeGreaterThan(0);
    // Asymmetric: the lower bound accommodates frail attackers, where our flat
    // 10s relobby diverges most from their per-faint modelling.
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.2);
  });

  it('stays within the measured ~10% optimism, without drifting', () => {
    const ratios = results.map((r) => r.ratio);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    // Pinned around the measured 0.898. A wrong constant anywhere in the damage
    // or energy path moves this well outside the band.
    expect(mean).toBeGreaterThan(0.84);
    expect(mean).toBeLessThan(0.96);
  });

  it('agrees on every tier separately, not just on average', () => {
    // This is what makes the tier constants testable. Each tier uses a
    // different bossCpm (0.5974 / 0.73 / 0.79), and a wrong one would show up
    // as that tier's mean sitting apart from the others — which an overall
    // average would hide.
    const byTier = new Map<string, number[]>();
    for (const r of results) {
      if (!byTier.has(r.tier)) byTier.set(r.tier, []);
      byTier.get(r.tier)!.push(r.ratio);
    }
    expect(byTier.size).toBeGreaterThanOrEqual(3);

    for (const [tier, ratios] of byTier) {
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      expect(mean, `tier ${tier} mean ratio`).toBeGreaterThan(0.78);
      expect(mean, `tier ${tier} mean ratio`).toBeLessThan(1.05);
    }
  });

  it('does not disagree wildly on any single matchup', () => {
    // Spread matters as much as the mean: a bug affecting one Pokémon class
    // (frail, dual-typed, high-energy moves) widens this without moving it.
    const ratios = results.map((r) => r.ratio);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.35);
  });

  it('covers more than one boss and more than one attacker', () => {
    expect(new Set(results.map((r) => r.boss)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(results.map((r) => r.attacker)).size).toBeGreaterThanOrEqual(4);
  });

  it('exercises every raid tier constant we ship', () => {
    // Tiers use different bossCpm values (0.5974 / 0.73 / 0.79). Checking only
    // tier 5 would leave the other two unverified against anything external.
    const tiers = new Set(results.map((r) => r.tier));
    expect(tiers).toContain('1');
    expect(tiers).toContain('3');
    expect(tiers).toContain('5');
  });

  it('includes shadow attackers, checking the shadow multipliers too', () => {
    expect(results.some((r) => r.isShadow)).toBe(true);
  });
});
