import { describe, expect, it } from 'vitest';
import { gm, getMove, getSpecies, stab, typeEffectiveness } from '../gamemaster';

describe('bundle integrity', () => {
  it('has the 18 types in attackScalar index order', () => {
    expect(gm.types).toHaveLength(18);
    expect(gm.types[0]).toBe('NORMAL');
    expect(gm.types[17]).toBe('FAIRY');
    for (const t of gm.types) expect(gm.typeChart[t]).toHaveLength(18);
  });

  it('every move a species can learn exists in the move table', () => {
    const missing: string[] = [];
    for (const s of Object.values(gm.species)) {
      for (const id of [...s.fastMoves, ...s.chargedMoves, ...s.eliteFastMoves, ...s.eliteChargedMoves]) {
        if (!gm.moves[id]) missing.push(`${s.id}:${id}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('classifies moves by energy sign consistently', () => {
    for (const m of Object.values(gm.moves)) {
      if (m.category === 'fast') expect(m.energy).toBeGreaterThanOrEqual(0);
      else expect(m.energy).toBeLessThanOrEqual(0);
      expect(m.damageWindowStartMs).toBeGreaterThanOrEqual(0);
      // UPPER_HAND ships with a damage window past the end of its own animation.
      // Left as-is rather than silently corrected; the sim clamps at use time.
      if (m.id !== 'UPPER_HAND') {
        expect(m.damageWindowStartMs).toBeLessThanOrEqual(m.durationMs);
      }
    }
  });

  it('carries the battle constants the damage formula needs', () => {
    expect(gm.settings.stab).toBe(1.2);
    expect(gm.settings.weatherBonus).toBe(1.2);
    expect(gm.settings.shadowAttackMultiplier).toBe(1.2);
    expect(gm.settings.maxEnergy).toBe(100);
    expect(gm.friendshipAttackMultipliers[0]).toBe(1);
  });
});

describe('known species stats', () => {
  // Base stats are widely published; these catch a parser regression immediately.
  it.each([
    ['MACHAMP', 234, 159, 207],
    ['RAYQUAZA', 284, 170, 213],
    ['MEWTWO', 300, 182, 214],
    ['LANDORUS_THERIAN', 289, 179, 205],
    ['GIRATINA_ORIGIN', 225, 187, 284],
    ['METAGROSS', 257, 228, 190],
  ])('%s', (id, atk, def, sta) => {
    const s = getSpecies(id);
    expect([s.baseAttack, s.baseDefense, s.baseStamina]).toEqual([atk, def, sta]);
  });

  it('keeps forms that differ and drops cosmetic duplicates', () => {
    expect(getSpecies('MAROWAK_ALOLA').types).toEqual(['FIRE', 'GHOST']);
    expect(getSpecies('MAROWAK').types).toEqual(['GROUND']);
    // Costume forms are stat-identical to the base and must not survive.
    expect(gm.species.BULBASAUR_FALL_2019).toBeUndefined();
    expect(gm.species.BULBASAUR_NORMAL).toBeUndefined();
  });

  it('reads mega stats and type overrides', () => {
    const megas = Object.fromEntries(getSpecies('CHARIZARD').megas.map((m) => [m.id, m]));
    expect(megas.TEMP_EVOLUTION_MEGA_X.types).toEqual(['FIRE', 'DRAGON']);
    expect(megas.TEMP_EVOLUTION_MEGA_X.baseAttack).toBe(273);
    expect(megas.TEMP_EVOLUTION_MEGA_Y.types).toEqual(['FIRE', 'FLYING']);
    expect(megas.TEMP_EVOLUTION_MEGA_Y.baseAttack).toBe(319);
  });

  it('separates elite-only moves from freely teachable ones', () => {
    const s = getSpecies('CHARIZARD');
    expect(s.eliteChargedMoves).toContain('BLAST_BURN');
    expect(s.chargedMoves).not.toContain('BLAST_BURN');
  });
});

describe('known moves', () => {
  it.each([
    ['COUNTER_FAST', 'FIGHTING', 13, 9, 1000],
    ['SHADOW_CLAW_FAST', 'GHOST', 6, 4, 500],
  ])('%s', (id, type, power, energy, duration) => {
    const m = getMove(id);
    expect([m.type, m.power, m.energy, m.durationMs]).toEqual([type, power, energy, duration]);
    expect(m.category).toBe('fast');
  });

  it('reads charged moves including numeric-id entries', () => {
    expect(getMove('DYNAMIC_PUNCH')).toMatchObject({ power: 85, energy: -50 });
    // AURA_WHEEL_ELECTRIC ships with a numeric movementId; the name comes from
    // the templateId instead.
    expect(getMove('AURA_WHEEL_ELECTRIC')).toMatchObject({ type: 'ELECTRIC', power: 100 });
  });
});

describe('type effectiveness', () => {
  it('multiplies across dual types', () => {
    // Rock vs Charizard (Fire/Flying) is double super effective.
    expect(typeEffectiveness('ROCK', ['FIRE', 'FLYING'])).toBeCloseTo(1.6 * 1.6, 6);
    // Electric vs Ground is the GO "immunity" floor, not zero.
    expect(typeEffectiveness('ELECTRIC', ['GROUND'])).toBeCloseTo(0.390625, 6);
    expect(typeEffectiveness('FIGHTING', ['NORMAL'])).toBeCloseTo(1.6, 6);
    expect(typeEffectiveness('WATER', ['FIRE'])).toBeCloseTo(1.6, 6);
  });

  it('cancels out when a dual type resists and is weak', () => {
    // Grass vs Water/Ground (Swampert) is 1.6 * 1.6; vs Water/Flying it cancels.
    expect(typeEffectiveness('GRASS', ['WATER', 'GROUND'])).toBeCloseTo(2.56, 6);
    expect(typeEffectiveness('GRASS', ['WATER', 'FLYING'])).toBeCloseTo(1, 6);
  });
});

describe('stab', () => {
  it('applies only on a type match', () => {
    expect(stab('FIRE', ['FIRE', 'FLYING'])).toBe(1.2);
    expect(stab('DRAGON', ['FIRE', 'FLYING'])).toBe(1);
  });
});

describe('packed bundle round-trip', () => {
  it('reconstructs id / pokemonId / form consistently', () => {
    // The pack step stores the base id only for variants, so these two shapes
    // are the only legal outcomes. A decoder bug would break one of them.
    for (const s of Object.values(gm.species)) {
      if (s.form === null) {
        expect(s.id).toBe(s.pokemonId);
      } else {
        expect(s.form).toBe(s.id);
        expect(s.pokemonId).not.toBe(s.id);
      }
    }
  });

  it('resolves every interned move index to a real move', () => {
    for (const s of Object.values(gm.species)) {
      for (const id of [...s.fastMoves, ...s.chargedMoves, ...s.eliteFastMoves, ...s.eliteChargedMoves]) {
        expect(typeof id).toBe('string');
        expect(gm.moves[id]).toBeDefined();
      }
    }
  });

  it('keeps type names, not indices, on the decoded records', () => {
    for (const s of Object.values(gm.species)) {
      expect(s.types.length).toBeGreaterThan(0);
      for (const t of s.types) expect(gm.types).toContain(t);
      for (const m of s.megas) for (const t of m.types) expect(gm.types).toContain(t);
    }
    for (const list of Object.values(gm.weatherAffinities)) {
      for (const t of list) expect(gm.types).toContain(t);
    }
  });

  it('rebuilds the type chart keyed by name', () => {
    for (const t of gm.types) expect(gm.typeChart[t]).toHaveLength(18);
  });
});
