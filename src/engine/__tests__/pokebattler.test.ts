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
 * Measured behaviour as of the fixture set (18 matchups, 3 bosses):
 *
 *   mean ratio 0.89, range 0.67-0.95
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
    { speciesId: f.attacker, level: 40, ivs, fastMove: f.fastMove, chargedMove: f.chargedMove },
    { speciesId: f.boss, tier: f.tier as RaidTier, ...moves },
  );
  return { ...f, ours, ratio: ours / f.estimator };
});

describe('agreement with Pokebattler', () => {
  it.each(results)('$attacker ($fastMove/$chargedMove) vs $boss', ({ ours, ratio }) => {
    expect(ours).toBeGreaterThan(0);
    // Asymmetric: the lower bound accommodates the frailest attackers, where
    // our flat 10s relobby diverges most from their per-faint modelling.
    // Blacephalon (def 148, sta 142) vs Regice sits at 0.67 with 14 faints.
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.2);
  });

  it('stays within the measured ~11% optimism, without drifting', () => {
    const ratios = results.map((r) => r.ratio);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    // Pinned tight around the measured 0.89. A wrong constant anywhere in the
    // damage or energy path moves this well outside the band.
    expect(mean).toBeGreaterThan(0.82);
    expect(mean).toBeLessThan(0.98);
  });

  it('does not disagree wildly on any single matchup', () => {
    // Spread matters as much as the mean: a bug affecting one Pokémon class
    // (frail, dual-typed, high-energy moves) widens this without moving it.
    const ratios = results.map((r) => r.ratio);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.45);
  });

  it('covers more than one boss and more than one attacker', () => {
    expect(new Set(results.map((r) => r.boss)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(results.map((r) => r.attacker)).size).toBeGreaterThanOrEqual(4);
  });
});
