import { describe, expect, it } from 'vitest';
import { getMove, getSpecies } from '../gamemaster';
import { bestMoveset, cycleDps, referenceAttacker, referenceDefender } from '../moveset';

describe('bestMoveset', () => {
  it('beats naively taking the first-listed moves', () => {
    // The old default was fastMoves[0]/chargedMoves[0], which is arbitrary
    // ordering from the dump rather than anything about the Pokémon.
    for (const id of ['METAGROSS', 'MACHAMP', 'TYRANITAR', 'RAYQUAZA']) {
      const s = getSpecies(id);
      const best = bestMoveset(id)!;
      const firstListed = cycleDps(
        referenceAttacker(id),
        referenceDefender(['NORMAL']),
        s.fastMoves[0],
        s.chargedMoves[0],
      );
      expect(best.dps).toBeGreaterThanOrEqual(firstListed);
    }
  });

  it('picks the type-appropriate moveset for the defender', () => {
    // Steel is super effective on Ice, so Metagross should reach for a Steel
    // charged move against an Ice target but not against a neutral one.
    expect(getMove(bestMoveset('METAGROSS', ['ICE'])!.chargedMove).type).toBe('STEEL');
    expect(getMove(bestMoveset('METAGROSS', ['NORMAL'])!.chargedMove).type).not.toBe('STEEL');
  });

  it('will not default to an Elite-TM-only move the user probably lacks', () => {
    // Meteor Mash is legacy on Metagross: strictly its best Steel move, and
    // exactly the kind of thing that would overstate a roster if defaulted to.
    expect(getSpecies('METAGROSS').eliteChargedMoves).toContain('METEOR_MASH');
    expect(bestMoveset('METAGROSS', ['ICE'])!.chargedMove).not.toBe('METEOR_MASH');
    expect(bestMoveset('METAGROSS', ['ICE'], { includeElite: true })!.chargedMove).toBe('METEOR_MASH');
  });

  it('changes its answer when the defender changes', () => {
    const a = bestMoveset('TYRANITAR', ['PSYCHIC']);
    const b = bestMoveset('TYRANITAR', ['STEEL']);
    expect([a?.fastMove, a?.chargedMove]).not.toEqual([b?.fastMove, b?.chargedMove]);
  });

  it('excludes elite moves unless asked for them', () => {
    expect(bestMoveset('CHARIZARD', ['GRASS'])?.chargedMove).not.toBe('BLAST_BURN');
    const elite = bestMoveset('CHARIZARD', ['GRASS'], { includeElite: true })!;
    const plain = bestMoveset('CHARIZARD', ['GRASS'])!;
    expect(elite.dps).toBeGreaterThanOrEqual(plain.dps);
  });

  it('handles a species with nothing worth using without throwing', () => {
    expect(() => bestMoveset('MAGIKARP')).not.toThrow();
  });
});
