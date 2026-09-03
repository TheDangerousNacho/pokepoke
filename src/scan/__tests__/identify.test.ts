import { describe, expect, it } from 'vitest';
import { identifyFromStats, parseTypes } from '../identify';
import { combatPower, cpm } from '../../engine/cpm';
import { getSpecies } from '../../engine/gamemaster';

const hundo = { attack: 15, defense: 15, stamina: 15 };
const statsFor = (id: string, level: number, ivs = hundo) => {
  const s = getSpecies(id);
  return {
    cp: combatPower(s, ivs, level),
    hp: Math.floor((s.baseStamina + ivs.stamina) * cpm(level)),
  };
};

describe('identifyFromStats', () => {
  it('finds the right species from CP and HP', () => {
    for (const [id, level] of [['MACHAMP', 40], ['METAGROSS', 35], ['TYRANITAR', 40]] as const) {
      const { cp, hp } = statsFor(id, level);
      const ids = identifyFromStats(cp, hp).map((m) => m.speciesId);
      expect(ids).toContain(id);
    }
  });

  it('recovers the level too', () => {
    const { cp, hp } = statsFor('METAGROSS', 30);
    const match = identifyFromStats(cp, hp).find((m) => m.speciesId === 'METAGROSS');
    expect(match?.levels).toContain(30);
  });

  it('lists each species once, not once per level', () => {
    const { cp, hp } = statsFor('MACHAMP', 40);
    const ids = identifyFromStats(cp, hp).map((m) => m.speciesId);
    expect(new Set(ids).size).toBe(ids.length);
  });



  it('still finds the species when IVs are not the assumed hundo', () => {
    // The whole point: real Pokémon are not 15/15/15, so the tolerances have
    // to survive that or the feature is useless in practice.
    for (const ivs of [
      { attack: 0, defense: 0, stamina: 0 },
      { attack: 10, defense: 4, stamina: 12 },
      { attack: 15, defense: 0, stamina: 7 },
    ]) {
      const { cp, hp } = statsFor('MACHAMP', 40, ivs);
      expect(identifyFromStats(cp, hp).map((m) => m.speciesId)).toContain('MACHAMP');
    }
  });

  it('narrows hard when types are known', () => {
    const { cp, hp } = statsFor('MACHAMP', 40);
    const all = identifyFromStats(cp, hp, { limit: 500 });
    const fighting = identifyFromStats(cp, hp, { types: ['FIGHTING'], limit: 500 });
    expect(fighting.length).toBeLessThan(all.length);
    expect(fighting.map((m) => m.speciesId)).toContain('MACHAMP');
  });

  it('cuts the dex down by at least an order of magnitude', () => {
    const { cp, hp } = statsFor('MACHAMP', 40);
    const matches = identifyFromStats(cp, hp, { limit: 2000 });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThan(120);
  });

  it('cuts much further again once types are known', () => {
    const { cp, hp } = statsFor('MACHAMP', 40);
    const all = identifyFromStats(cp, hp, { limit: 2000 });
    const typed = identifyFromStats(cp, hp, { types: ['FIGHTING'], limit: 2000 });
    expect(typed.length).toBeLessThan(all.length / 2);
    expect(typed.map((m) => m.speciesId)).toContain('MACHAMP');
  });

  it('returns nothing for impossible input', () => {
    expect(identifyFromStats(0, 0)).toEqual([]);
    expect(identifyFromStats(NaN, 100)).toEqual([]);
    expect(identifyFromStats(99999, 99999)).toEqual([]);
  });
});

describe('parseTypes', () => {
  it('reads the badges', () => {
    expect(parseTypes('Machamp\nFIGHTING\nWEIGHT 129 kg')).toEqual(['FIGHTING']);
    expect(new Set(parseTypes('Charizard\nFIRE  FLYING'))).toEqual(new Set(['FIRE', 'FLYING']));
  });

  it('ignores text that mentions too many types to be badges', () => {
    expect(parseTypes('strong against fire water grass electric')).toEqual([]);
  });

  it('returns nothing when no types appear', () => {
    expect(parseTypes('CP 3056\nHP 175/175')).toEqual([]);
  });
});
