import { describe, expect, it } from 'vitest';
import { intersectLevels, levelsFromUpgradeCost, parseUpgradeCost } from '../powerUp';

describe('levelsFromUpgradeCost', () => {
  it('matches the published costs for known levels', () => {
    // 5,000 dust / 4 candy is level 30 — the reading from a sample screenshot.
    const band = levelsFromUpgradeCost({ stardust: 5000, candy: 4 })!;
    expect(band.levels).toContain(30);
    expect(band.min).toBeGreaterThanOrEqual(29);
    expect(band.max).toBeLessThanOrEqual(30.5);
  });

  it('narrows to a couple of whole levels at most', () => {
    // 6,000 / 6 is levels 31-32 — the other sample reading.
    const band = levelsFromUpgradeCost({ stardust: 6000, candy: 6 })!;
    expect(band.min).toBe(31);
    expect(band.max).toBe(32.5);
    expect(band.levels.length).toBeLessThanOrEqual(4);
  });

  it('cannot separate a whole level from its half step', () => {
    // Both half-steps in a level cost the same, so this is a real limit rather
    // than something to fix.
    const band = levelsFromUpgradeCost({ stardust: 5000, candy: 4 })!;
    expect(band.levels).toContain(30);
    expect(band.levels).toContain(30.5);
  });

  it('rejects a pair that no level produces', () => {
    expect(levelsFromUpgradeCost({ stardust: 5000, candy: 99 })).toBeNull();
    expect(levelsFromUpgradeCost({ stardust: 1234, candy: 4 })).toBeNull();
  });

  it('accounts for the shadow surcharge', () => {
    const normal = levelsFromUpgradeCost({ stardust: 5000, candy: 4 })!;
    const shadow = levelsFromUpgradeCost({ stardust: 6000, candy: 5 }, { isShadow: true });
    expect(shadow?.levels).toEqual(normal.levels);
  });
});

describe('parseUpgradeCost', () => {
  it('reads the button and ignores the stardust balance', () => {
    // The balance (622,462) is six digits and outside the cost table, and the
    // pair must jointly agree on a level, which is what makes this safe.
    const text = '622,462 81 70\nSTARDUST EEVEE CANDY EEVEE CANDY XL\nPOWER UP 5,000 4';
    expect(parseUpgradeCost(text)).toEqual({ stardust: 5000, candy: 4 });
  });

  it('reads the other sample screen', () => {
    expect(parseUpgradeCost('POWER UP 6,000 6')).toEqual({ stardust: 6000, candy: 6 });
  });

  it('returns null when the row was not read', () => {
    expect(parseUpgradeCost('CP 3056\nMachamp\nHP 175/175')).toBeNull();
  });

  it('does not invent a reading from unrelated numbers', () => {
    expect(parseUpgradeCost('WEIGHT 129.15 kg HEIGHT 1.60 m')).toBeNull();
  });

  it('recovers when the icons are read as a leading digit', () => {
    // Verbatim OCR from two sample screenshots: the stardust icon became a
    // leading 1, and the candy icon a leading 2.
    expect(parseUpgradeCost('POWER UP 15000 4')).toEqual({ stardust: 5000, candy: 4 });
    expect(parseUpgradeCost('POWER UP 16000 26')).toEqual({ stardust: 6000, candy: 6 });
  });
});

describe('intersectLevels', () => {
  it('narrows candidates to the band', () => {
    const band = levelsFromUpgradeCost({ stardust: 5000, candy: 4 });
    expect(intersectLevels(band, [30, 34, 35.5, 36, 36.5])).toEqual([30]);
  });

  it('passes candidates through when there is no band', () => {
    expect(intersectLevels(null, [30, 34])).toEqual([30, 34]);
  });

  it('keeps the originals rather than emptying when they disagree', () => {
    const band = levelsFromUpgradeCost({ stardust: 200, candy: 1 });
    expect(intersectLevels(band, [40, 41])).toEqual([40, 41]);
  });
});
