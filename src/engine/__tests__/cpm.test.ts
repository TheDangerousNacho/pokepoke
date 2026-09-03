import { describe, expect, it } from 'vitest';
import { combatPower, cpm, effectiveStat } from '../cpm';
import { getSpecies } from '../gamemaster';

describe('cpm', () => {
  it('matches published whole-level multipliers', () => {
    expect(cpm(1)).toBeCloseTo(0.094, 7);
    expect(cpm(20)).toBeCloseTo(0.5974, 7);
    expect(cpm(30)).toBeCloseTo(0.7317, 7);
    expect(cpm(40)).toBeCloseTo(0.7903, 7);
    expect(cpm(50)).toBeCloseTo(0.8403, 7);
  });

  it('interpolates half levels to the published values', () => {
    // Quadratic mean of the neighbouring whole levels. Cross-checked against
    // PvPoke's half-step table for every level 1..55 (max delta 3e-8).
    expect(cpm(1.5)).toBeCloseTo(0.13513743, 7);
    expect(cpm(20.5)).toBeCloseTo(0.60482366, 7);
    expect(cpm(30.5)).toBeCloseTo(0.73474101, 7);
    expect(cpm(39.5)).toBeCloseTo(0.78747358, 7);
    expect(cpm(49.5)).toBeCloseTo(0.83780376, 7);
  });

  it('increases monotonically across every half step', () => {
    for (let l = 1; l < 50; l += 0.5) expect(cpm(l + 0.5)).toBeGreaterThan(cpm(l));
  });

  it('rejects levels it cannot represent', () => {
    expect(() => cpm(0)).toThrow();
    expect(() => cpm(20.25)).toThrow();
    expect(() => cpm(999)).toThrow();
  });
});

describe('effectiveStat', () => {
  it('is (base + IV) * cpm', () => {
    expect(effectiveStat(234, 15, 40)).toBeCloseTo(249 * 0.7903, 6);
  });
});

describe('combatPower', () => {
  // Cross-checks the whole stat pipeline: any CPM or base-stat error shows up here.
  it.each([
    ['MACHAMP', 40, 3056],
    ['RAYQUAZA', 40, 3835],
    ['MEWTWO', 40, 4178],
    ['METAGROSS', 40, 3791],
  ])('hundo %s at level %s is %s CP', (id, level, expected) => {
    const s = getSpecies(id);
    expect(combatPower(s, { attack: 15, defense: 15, stamina: 15 }, level)).toBe(expected);
  });

  it('floors at 10 CP', () => {
    const s = getSpecies('MAGIKARP');
    expect(combatPower(s, { attack: 0, defense: 0, stamina: 0 }, 1)).toBe(10);
  });
});
