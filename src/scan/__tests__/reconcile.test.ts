import { describe, expect, it } from 'vitest';
import { reconcile } from '../reconcile';
import { combatPower, cpm } from '../../engine/cpm';
import { getSpecies } from '../../engine/gamemaster';

const hundo = { attack: 15, defense: 15, stamina: 15 };
const statsFor = (id: string, level: number) => {
  const s = getSpecies(id);
  return { cp: combatPower(s, hundo, level), hp: Math.floor((s.baseStamina + 15) * cpm(level)) };
};

describe('reconcile', () => {
  it('uses both readings when they agree', () => {
    const { cp, hp } = statsFor('MACHAMP', 40);
    const r = reconcile('MACHAMP', cp, hp);
    expect(r.consistent).toBe(true);
    expect(r.source).toBe('cp+hp');
    expect(r.level).toBeCloseTo(40, 0);
  });

  it('catches a truncated CP and falls back to HP', () => {
    // The real failure from a sample screenshot: Tyrantrum's 2697 read as 269.
    const { hp } = statsFor('TYRANTRUM', 36.5);
    const r = reconcile('TYRANTRUM', 269, hp);
    expect(r.consistent).toBe(false);
    expect(r.source).toBe('hp');
    expect(r.level).toBeGreaterThan(30);
    expect(r.expectedCp!.min).toBeGreaterThan(1000);
  });

  it('works from HP alone, but says the level is approximate', () => {
    // HP alone genuinely cannot pin a level - a high stamina IV low down and a
    // low one higher up give the same HP - so this only has to land in range.
    const { hp } = statsFor('METAGROSS', 30);
    const r = reconcile('METAGROSS', null, hp);
    expect(r.source).toBe('hp');
    expect(r.consistent).toBe(true);
    expect(r.approximate).toBe(true);
    expect(r.level).toBeGreaterThanOrEqual(28);
    expect(r.level).toBeLessThanOrEqual(38);
  });

  it('works from CP alone', () => {
    const { cp } = statsFor('METAGROSS', 30);
    const r = reconcile('METAGROSS', cp, null);
    expect(r.source).toBe('cp');
    expect(r.level).toBe(30);
  });

  it('reports nothing when it has nothing', () => {
    const r = reconcile('MACHAMP', null, null);
    expect(r.level).toBeNull();
    expect(r.source).toBe('none');
  });

  it('expected CP range brackets the true CP for every sample matchup', () => {
    // Guards the range being too narrow, which would flag good reads as bad.
    for (const [id, level] of [['GROUDON', 26], ['GYARADOS', 37], ['SKELEDIRGE', 33.5]] as const) {
      const { cp, hp } = statsFor(id, level);
      const r = reconcile(id, cp, hp);
      expect(r.consistent).toBe(true);
      expect(cp).toBeGreaterThanOrEqual(r.expectedCp!.min);
      expect(cp).toBeLessThanOrEqual(r.expectedCp!.max);
    }
  });
});
