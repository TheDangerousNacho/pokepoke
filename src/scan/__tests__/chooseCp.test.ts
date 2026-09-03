import { describe, expect, it } from 'vitest';
import { chooseCp } from '../ocr';
import { combatPower, cpm } from '../../engine/cpm';
import { getSpecies } from '../../engine/gamemaster';

const hundo = { attack: 15, defense: 15, stamina: 15 };
const statsFor = (id: string, level: number) => {
  const s = getSpecies(id);
  return { cp: combatPower(s, hundo, level), hp: Math.floor((s.baseStamina + 15) * cpm(level)) };
};

const cand = (value: number, labelled = true, pass = 'cp-band-0.0') => ({ value, labelled, pass });

describe('chooseCp', () => {
  it('returns nothing when there is nothing to choose', () => {
    expect(chooseCp([], 'MACHAMP', 175)).toBeNull();
  });

  it('picks the candidate the HP agrees with', () => {
    const { cp, hp } = statsFor('SKELEDIRGE', 33.5);
    // A truncated reading — the kind that actually happens.
    expect(chooseCp([cand(274), cand(cp)], 'SKELEDIRGE', hp)).toBe(cp);
  });

  it('cannot separate readings that differ by a single digit', () => {
    // Documented limitation, not an aspiration: HP admits a CP window of about
    // ±10%, so 2563 and 2583 are both consistent. Only the label ordering
    // separates them, which is why unlabelled numbers are never candidates.
    const { cp, hp } = statsFor('SKELEDIRGE', 33.5);
    expect(chooseCp([cand(cp - 20), cand(cp)], 'SKELEDIRGE', hp)).toBe(cp - 20);
  });

  it('rejects a wildly wrong reading even though it is labelled', () => {
    const { cp, hp } = statsFor('MACHAMP', 40);
    // 716 is the status bar clock, the original bug.
    expect(chooseCp([cand(716), cand(cp)], 'MACHAMP', hp)).toBe(cp);
  });

  it('falls back to the first reading when none agree with HP', () => {
    // Better to show something the review screen can flag than an empty field.
    const { hp } = statsFor('MACHAMP', 40);
    expect(chooseCp([cand(9999)], 'MACHAMP', hp)).toBe(9999);
  });

  it('works with no species, since a renamed Pokémon has none yet', () => {
    expect(chooseCp([cand(2625)], null, 168)).toBe(2625);
  });
});
