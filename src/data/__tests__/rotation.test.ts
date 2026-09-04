import { describe, expect, it } from 'vitest';
import { fetchRotation, parseRotation } from '../rotation';
import { gm } from '../../engine/gamemaster';

const feed = {
  tiers: [
    { tier: 'RAID_LEVEL_5', raids: [{ pokemon: 'REGIROCK', shiny: true }] },
    { tier: 'RAID_LEVEL_MEGA', raids: [
      { pokemon: 'RAICHU_MEGA_X' },
      { pokemon: 'RAICHU_MEGA_Y' },
      { pokemon: 'GYARADOS_MEGA' },
    ] },
    { tier: 'RAID_LEVEL_5_SHADOW', raids: [{ pokemon: 'GIRATINA_SHADOW_FORM' }] },
    { tier: 'RAID_LEVEL_3', raids: [{ pokemon: 'SNEASEL_HISUIAN_FORM' }] },
    // Dropped: not a tier we map, and a Pokémon nothing knows about.
    { tier: 'RAID_LEVEL_5_LEGACY', raids: [{ pokemon: 'MEWTWO' }] },
    { tier: 'RAID_LEVEL_1', raids: [{ pokemon: 'NOT_A_POKEMON' }] },
  ],
};

describe('parseRotation', () => {
  const { bosses, skipped } = parseRotation(feed, gm.species);
  const find = (speciesId: string, megaId?: string) =>
    bosses.find((b) => b.speciesId === speciesId && b.megaId === megaId);

  it('keeps the two mega forms apart', () => {
    expect(find('RAICHU', 'TEMP_EVOLUTION_MEGA_X')).toBeDefined();
    expect(find('RAICHU', 'TEMP_EVOLUTION_MEGA_Y')).toBeDefined();
    // The plain _MEGA suffix must not swallow _MEGA_X, which is what makes
    // "Mega Raichu twice" the right answer rather than a duplicate.
    expect(find('RAICHU', 'TEMP_EVOLUTION_MEGA')).toBeUndefined();
  });

  it('maps a single mega, a shadow and a regional form', () => {
    expect(find('GYARADOS', 'TEMP_EVOLUTION_MEGA')).toBeDefined();
    // Shadow is carried by the tier, so the species is the base one.
    expect(find('GIRATINA')?.tier).toBe('SHADOW_5');
    expect(find('SNEASEL_HISUIAN')?.tier).toBe('3');
  });

  it('drops unmapped tiers and reports unmatched species', () => {
    expect(find('MEWTWO')).toBeUndefined();
    expect(skipped).toContain('NOT_A_POKEMON (RAID_LEVEL_1)');
  });

  it('defaults a moveset the feed does not carry', () => {
    const regirock = find('REGIROCK')!;
    expect(regirock.fastMove).toBe(gm.species.REGIROCK.fastMoves[0]);
    expect(regirock.shiny).toBe(true);
  });

  it('refuses a feed with no tiers rather than returning nothing', () => {
    expect(() => parseRotation({}, gm.species)).toThrow(/no tiers/);
  });
});

describe('fetchRotation', () => {
  it('reports a failed request instead of an empty rotation', async () => {
    const failing = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchRotation(gm.species, failing)).rejects.toThrow(/503/);
  });

  it('parses a successful response', async () => {
    const ok = (async () => new Response(JSON.stringify(feed))) as unknown as typeof fetch;
    const { bosses } = await fetchRotation(gm.species, ok);
    expect(bosses.length).toBeGreaterThan(0);
  });
});
