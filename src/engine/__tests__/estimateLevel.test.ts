import { describe, expect, it } from 'vitest';
import { estimateLevel, isPlausibleCp, maxCp } from '../estimateLevel';
import { combatPower } from '../cpm';
import { getSpecies } from '../gamemaster';

const hundo = { attack: 15, defense: 15, stamina: 15 };

describe('estimateLevel', () => {
  it('recovers the exact level of a hundo round-trip', () => {
    for (const id of ['MACHAMP', 'METAGROSS', 'TYRANITAR', 'MAGIKARP']) {
      for (const level of [15, 20, 25, 30, 35, 40, 50]) {
        const cp = combatPower(getSpecies(id), hundo, level);
        const estimate = estimateLevel(id, cp);
        expect(estimate.level).toBe(level);
        expect(estimate.approximate).toBe(false);
      }
    }
  });

  it('handles half levels', () => {
    const cp = combatPower(getSpecies('MACHAMP'), hundo, 27.5);
    expect(estimateLevel('MACHAMP', cp).level).toBe(27.5);
  });

  it('flags an estimate it could not hit exactly', () => {
    // A CP no level produces for this species.
    const estimate = estimateLevel('MACHAMP', 3055);
    expect(estimate.approximate).toBe(true);
    expect(Math.abs(estimate.cp - 3055)).toBeLessThan(60);
  });

  it('under-estimates rather than over-estimates when IVs are assumed high', () => {
    // A real 0/0/0 Machamp at level 40 shows a lower CP than a hundo does, so
    // assuming a hundo maps that CP to a LOWER level. Understating damage is
    // the safe direction for a "can we win this" tool.
    const realCp = combatPower(getSpecies('MACHAMP'), { attack: 0, defense: 0, stamina: 0 }, 40);
    expect(estimateLevel('MACHAMP', realCp).level).toBeLessThan(40);
  });

  it('clamps rather than throwing on an absurd CP', () => {
    expect(() => estimateLevel('MAGIKARP', 99999)).not.toThrow();
    expect(estimateLevel('MAGIKARP', 99999).approximate).toBe(true);
  });
});

describe('isPlausibleCp', () => {
  it('accepts real CPs', () => {
    expect(isPlausibleCp('MACHAMP', 3056)).toBe(true);
    expect(isPlausibleCp('MAGIKARP', 274)).toBe(true);
  });

  it('rejects CPs the species cannot reach', () => {
    // A misread turning Magikarp's 274 into 2740 must not slip through.
    expect(isPlausibleCp('MAGIKARP', 2740)).toBe(false);
    expect(isPlausibleCp('MACHAMP', 99999)).toBe(false);
    expect(isPlausibleCp('MACHAMP', 5)).toBe(false);
  });
});

describe('maxCp', () => {
  it('matches published maximums', () => {
    expect(maxCp('MACHAMP', 40)).toBe(3056);
    expect(maxCp('METAGROSS', 40)).toBe(3791);
  });
});
