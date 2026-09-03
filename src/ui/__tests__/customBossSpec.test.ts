import { describe, expect, it } from 'vitest';
import { getSpecies } from '../../engine/gamemaster';
import { getTier } from '../../engine/raidTiers';
import { buildBoss } from '../../engine/stats';
import { buildCustomBoss } from '../customBossSpec';

describe('buildCustomBoss', () => {
  it('defaults to the first listed moveset, as the rotation feed does', () => {
    const species = getSpecies('RAYQUAZA');
    const boss = buildCustomBoss('RAYQUAZA', '5')!;
    expect(boss.fastMove).toBe(species.fastMoves[0]);
    expect(boss.chargedMove).toBe(species.chargedMoves[0]);
  });

  it('never defaults to an Elite-TM-only move', () => {
    for (const id of ['MEWTWO', 'TYRANITAR', 'GYARADOS']) {
      const species = getSpecies(id);
      const boss = buildCustomBoss(id, '5')!;
      expect(species.eliteFastMoves).not.toContain(boss.fastMove);
      expect(species.eliteChargedMoves).not.toContain(boss.chargedMove);
    }
  });

  it('picks a mega form for mega tiers and none otherwise', () => {
    expect(buildCustomBoss('CHARIZARD', 'MEGA')!.megaId).toBeDefined();
    expect(buildCustomBoss('CHARIZARD', '5')!.megaId).toBeUndefined();
  });

  it('honours an explicitly chosen mega form', () => {
    const megas = getSpecies('CHARIZARD').megas;
    expect(megas.length).toBeGreaterThan(1);
    const boss = buildCustomBoss('CHARIZARD', 'MEGA', megas[1].id)!;
    expect(boss.megaId).toBe(megas[1].id);
  });

  it('builds something the simulator accepts, with the tier HP', () => {
    const boss = buildCustomBoss('RAYQUAZA', 'MEGA_LEGENDARY')!;
    const built = buildBoss(boss);
    expect(built.hp).toBe(getTier('MEGA_LEGENDARY').bossHp);
    // Mega Rayquaza keeps Dragon/Flying, so this also checks the mega's stat
    // line was resolved rather than the base form's.
    expect(built.attack).toBeGreaterThan(buildBoss(buildCustomBoss('RAYQUAZA', '5')!).attack);
  });
});

describe('the species list', () => {
  it('leaves out forms with no moves, which cannot be simulated', async () => {
    const { ALL_SPECIES } = await import('../search');
    expect(ALL_SPECIES.some((s) => s.id === 'SMEARGLE')).toBe(false);
    expect(ALL_SPECIES.some((s) => s.id === 'RAYQUAZA')).toBe(true);
  });
});

describe('bossName', () => {
  it('names the mega form, because it is a different fight', async () => {
    const { bossName } = await import('../format');
    const mega = buildCustomBoss('CHARIZARD', 'MEGA')!;
    expect(bossName(mega)).toMatch(/^Mega .*Charizard$/);
    expect(bossName(buildCustomBoss('CHARIZARD', '5')!)).toBe('Charizard');
  });
});
