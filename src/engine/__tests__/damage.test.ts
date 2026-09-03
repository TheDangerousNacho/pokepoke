import { describe, expect, it } from 'vitest';
import { damage, damageMultiplier, energyFromDamageTaken, isWeatherBoosted } from '../damage';
import { getMove } from '../gamemaster';
import { buildAttacker, buildBoss } from '../stats';
import type { Combatant } from '../stats';

/** Minimal stand-ins so formula tests do not depend on any species' real stats. */
const atk = (attack: number, types: Combatant['types']) => ({ attack, types });
const def = (defense: number, types: Combatant['types']) => ({ defense, types });

describe('damage formula', () => {
  it('is floor(0.5 * power * atk/def * mult) + 1', () => {
    // 0.5 * 100 * (200/100) * 1 = 100, +1 = 101. Neutral, no STAB.
    expect(damage(atk(200, ['NORMAL']), def(100, ['FIRE']), getMove('DYNAMIC_PUNCH'))).toBe(
      Math.floor(0.5 * 85 * 2) + 1,
    );
  });

  it('never deals less than 1', () => {
    // Tiny attack against a huge defense still lands for the floor of 1.
    expect(damage(atk(1, ['NORMAL']), def(100000, ['STEEL']), getMove('TACKLE_FAST'))).toBe(1);
  });

  it('floors before adding one, not after', () => {
    // Chosen so the raw product lands just under an integer; a round-then-add
    // implementation would come out one higher.
    const raw = 0.5 * 85 * (199 / 100);
    expect(raw % 1).toBeGreaterThan(0);
    expect(damage(atk(199, ['NORMAL']), def(100, ['FIRE']), getMove('DYNAMIC_PUNCH'))).toBe(
      Math.floor(raw) + 1,
    );
  });

  it('scales linearly with attack and inversely with defense', () => {
    // Ratios chosen so no step needs the floor, isolating the scaling itself.
    const punch = getMove('DYNAMIC_PUNCH');
    const base = damage(atk(400, ['NORMAL']), def(100, ['FIRE']), punch);
    expect(damage(atk(800, ['NORMAL']), def(100, ['FIRE']), punch) - 1).toBe((base - 1) * 2);
    expect(damage(atk(400, ['NORMAL']), def(200, ['FIRE']), punch) - 1).toBe((base - 1) / 2);
    expect(damage(atk(800, ['NORMAL']), def(200, ['FIRE']), punch)).toBe(base);
  });
});

describe('multipliers', () => {
  const punch = getMove('DYNAMIC_PUNCH'); // FIGHTING

  it('applies STAB only on a type match', () => {
    expect(damageMultiplier(atk(1, ['FIGHTING']), def(1, ['NORMAL']), punch)).toBeCloseTo(1.2 * 1.6, 6);
    expect(damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch)).toBeCloseTo(1.6, 6);
  });

  it('stacks type effectiveness across both defender types', () => {
    // Fighting vs Dark/Ice (Weavile) is doubly super effective.
    expect(damageMultiplier(atk(1, ['WATER']), def(1, ['DARK', 'ICE']), punch)).toBeCloseTo(2.56, 6);
    // Fighting vs Ghost is the double-resist floor.
    expect(damageMultiplier(atk(1, ['WATER']), def(1, ['GHOST']), punch)).toBeCloseTo(0.390625, 6);
  });

  it('applies weather only to boosted types', () => {
    expect(isWeatherBoosted('FIGHTING', 'OVERCAST')).toBe(true);
    expect(isWeatherBoosted('FIGHTING', 'SNOW')).toBe(false);
    const boosted = damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch, { weather: 'OVERCAST' });
    const plain = damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch);
    expect(boosted / plain).toBeCloseTo(1.2, 6);
  });

  it('applies friendship, and nothing at level 0', () => {
    const base = damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch);
    expect(damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch, { friendshipLevel: 0 })).toBeCloseTo(base, 6);
    expect(damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch, { friendshipLevel: 4 }) / base).toBeCloseTo(1.1, 6);
  });

  it('applies the lobby mega boost by move type', () => {
    const base = damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch);
    const same = damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch, { megaBoostTypes: ['FIGHTING'] });
    const other = damageMultiplier(atk(1, ['WATER']), def(1, ['NORMAL']), punch, { megaBoostTypes: ['WATER'] });
    expect(same / base).toBeCloseTo(1.3, 6);
    expect(other / base).toBeCloseTo(1.1, 6);
  });

  it('compounds every modifier at once', () => {
    const m = damageMultiplier(atk(1, ['FIGHTING']), def(1, ['DARK', 'ICE']), punch, {
      weather: 'OVERCAST',
      friendshipLevel: 4,
      megaBoostTypes: ['FIGHTING'],
    });
    expect(m).toBeCloseTo(1.2 * 2.56 * 1.2 * 1.1 * 1.3, 6);
  });
});

describe('shadow', () => {
  const entry = {
    speciesId: 'MACHAMP',
    level: 40,
    ivs: { attack: 15, defense: 15, stamina: 15 },
    fastMove: 'COUNTER_FAST',
    chargedMove: 'DYNAMIC_PUNCH',
  };

  it('hits 1.2x harder and takes more damage', () => {
    const normal = buildAttacker(entry);
    const shadow = buildAttacker({ ...entry, isShadow: true });
    expect(shadow.attack / normal.attack).toBeCloseTo(1.2, 6);
    expect(shadow.defense / normal.defense).toBeCloseTo(0.8333333, 6);
    expect(shadow.hp).toBe(normal.hp);
  });
});

describe('mega forms', () => {
  it('uses the mega stat line and type override', () => {
    const entry = {
      speciesId: 'CHARIZARD',
      level: 40,
      ivs: { attack: 15, defense: 15, stamina: 15 },
      fastMove: 'FIRE_SPIN_FAST',
      chargedMove: 'BLAST_BURN',
    };
    const plain = buildAttacker(entry);
    const megaX = buildAttacker({ ...entry, megaId: 'TEMP_EVOLUTION_MEGA_X' });
    expect(plain.types).toEqual(['FIRE', 'FLYING']);
    expect(megaX.types).toEqual(['FIRE', 'DRAGON']);
    expect(megaX.attack).toBeGreaterThan(plain.attack);
  });

  it('rejects a mega the species does not have', () => {
    expect(() =>
      buildAttacker({
        speciesId: 'MACHAMP',
        level: 40,
        ivs: { attack: 15, defense: 15, stamina: 15 },
        fastMove: 'COUNTER_FAST',
        chargedMove: 'DYNAMIC_PUNCH',
        megaId: 'TEMP_EVOLUTION_MEGA_X',
      }),
    ).toThrow(/no mega form/);
  });
});

describe('boss construction', () => {
  it('takes HP from the tier, not from base stamina', () => {
    const boss = buildBoss({ speciesId: 'MEWTWO', tier: 5, fastMove: 'PSYCHO_CUT_FAST', chargedMove: 'PSYSTRIKE' });
    expect(boss.hp).toBe(15000);
    expect(boss.types).toEqual(['PSYCHIC']);
  });

  it('gives the same HP regardless of species within a tier', () => {
    const a = buildBoss({ speciesId: 'MEWTWO', tier: 5, fastMove: 'PSYCHO_CUT_FAST', chargedMove: 'PSYSTRIKE' });
    const b = buildBoss({ speciesId: 'RAYQUAZA', tier: 5, fastMove: 'AIR_SLASH_FAST', chargedMove: 'HURRICANE' });
    expect(a.hp).toBe(b.hp);
    expect(a.defense).not.toBe(b.defense);
  });
});

describe('boss energy gain', () => {
  it('is half the damage taken, rounded up', () => {
    expect(energyFromDamageTaken(10)).toBe(5);
    expect(energyFromDamageTaken(11)).toBe(6);
  });
});
