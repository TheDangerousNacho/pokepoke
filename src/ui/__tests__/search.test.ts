import { describe, expect, it } from 'vitest';
import { searchSpecies } from '../search';
import { speciesName, moveName } from '../format';

describe('speciesName', () => {
  it('titles base forms plainly', () => {
    expect(speciesName('MACHAMP')).toBe('Machamp');
    expect(speciesName('GIRATINA')).toBe('Giratina');
  });

  it('breaks out variant forms', () => {
    expect(speciesName('GIRATINA_ORIGIN')).toBe('Giratina (Origin)');
    expect(speciesName('MAROWAK_ALOLA')).toBe('Marowak (Alola)');
    expect(speciesName('LANDORUS_THERIAN')).toBe('Landorus (Therian)');
  });
});

describe('moveName', () => {
  it('drops the FAST suffix and titles the rest', () => {
    expect(moveName('SHADOW_CLAW_FAST')).toBe('Shadow Claw');
    expect(moveName('DYNAMIC_PUNCH')).toBe('Dynamic Punch');
  });
});

describe('searchSpecies', () => {
  it('finds a base form and its variants from one query', () => {
    // This is the whole reason search exists: the ids are inconsistent, so
    // typing "giratina" must surface both Altered (keyed GIRATINA) and Origin.
    const ids = searchSpecies('giratina').map((s) => s.id);
    expect(ids).toContain('GIRATINA');
    expect(ids).toContain('GIRATINA_ORIGIN');
  });

  it('ranks an exact match first', () => {
    expect(searchSpecies('machamp')[0].id).toBe('MACHAMP');
    expect(searchSpecies('mewtwo')[0].id).toBe('MEWTWO');
  });

  it('ignores punctuation and case', () => {
    expect(searchSpecies('ho-oh').map((s) => s.id)).toContain('HO_OH');
  });

  it('returns nothing for gibberish', () => {
    expect(searchSpecies('zzzzqqq')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(searchSpecies('', 10)).toHaveLength(10);
  });
});
