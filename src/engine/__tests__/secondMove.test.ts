import { describe, expect, it } from 'vitest';
import { getSpecies } from '../gamemaster';
import { evaluateSecondMove, rankSecondMoves } from '../secondMove';
import type { RaidBossSpec, RosterEntry } from '../stats';

const ivs = { attack: 15, defense: 15, stamina: 15 };
const mon = (speciesId: string, fastMove: string, chargedMove: string, extra: Partial<RosterEntry> = {}): RosterEntry =>
  ({ speciesId, level: 40, ivs, fastMove, chargedMove, ...extra });

const annihilape = (extra: Partial<RosterEntry> = {}) =>
  mon('ANNIHILAPE', 'COUNTER_FAST', 'CLOSE_COMBAT', extra);

const bosses: RaidBossSpec[] = [
  { speciesId: 'GIRATINA', tier: '5', fastMove: 'SHADOW_CLAW_FAST', chargedMove: 'DRAGON_CLAW' },
  { speciesId: 'REGIROCK', tier: '5', fastMove: 'ROCK_THROW_FAST', chargedMove: 'STONE_EDGE' },
  { speciesId: 'REGISTEEL', tier: '5', fastMove: 'METAL_CLAW_FAST', chargedMove: 'FLASH_CANNON' },
];

describe('evaluateSecondMove', () => {
  it('values coverage across bosses, not damage in one fight', () => {
    const r = evaluateSecondMove(annihilape(), bosses)!;
    expect(r.pairDps).toBeGreaterThan(r.singleDps);
    // A pair can never beat the best single move on a boss the single move is
    // already right for, so the gain comes entirely from the fights it covers.
    expect(r.helpsAgainst.length).toBeGreaterThan(0);
    expect(r.helpsAgainst.length).toBeLessThan(bosses.length);
  });

  it('finds no value when one move is right for every boss', () => {
    const oneBoss = evaluateSecondMove(annihilape(), [bosses[0]])!;
    // Against a single boss there is nothing to cover, so a pair is worth
    // exactly nothing over the better half of it.
    expect(oneBoss.gain).toBeCloseTo(0, 10);
  });

  it('prices the unlock from the Game Master, per species', () => {
    const r = evaluateSecondMove(annihilape(), bosses)!;
    expect(r.cost).toEqual(getSpecies('ANNIHILAPE').secondMoveCost);
    expect(r.cost.stardust).toBeGreaterThan(0);
  });

  it('says nothing about a Pokémon that already has two', () => {
    expect(evaluateSecondMove(annihilape({ chargedMove2: 'SHADOW_BALL' }), bosses)).toBeNull();
  });

  it('says nothing about a species that cannot unlock one', () => {
    // Smeargle carries the "never" sentinel in the dump.
    expect(getSpecies('SMEARGLE').secondMoveCost).toBeNull();
  });

  it('never proposes an Elite-TM-only move, which the unlock cannot give', () => {
    const species = getSpecies('ANNIHILAPE');
    const r = evaluateSecondMove(annihilape(), bosses)!;
    expect(species.eliteChargedMoves).not.toContain(r.addition);
    expect(species.eliteChargedMoves).not.toContain(r.primary);
  });

  it('flags when the pair needs a TM before the unlock is worth it', () => {
    const wrongMove = annihilape({ chargedMove: 'LOW_SWEEP' });
    const r = evaluateSecondMove(wrongMove, bosses)!;
    expect(r.needsTmFirst).toBe(r.primary !== 'LOW_SWEEP');
  });
});

describe('rankSecondMoves', () => {
  it('ranks by gain per stardust, so cheap Pokémon are not buried', () => {
    const roster = [annihilape(), mon('METAGROSS', 'BULLET_PUNCH_FAST', 'METEOR_MASH')];
    const ranked = rankSecondMoves(roster, bosses, { minimumGain: 0 });
    for (let i = 1; i < ranked.length; i++) {
      const prev = ranked[i - 1];
      const cur = ranked[i];
      expect(prev.gain / prev.cost.stardust).toBeGreaterThanOrEqual(cur.gain / cur.cost.stardust);
    }
  });

  it('drops gains too small to be worth the dust', () => {
    const roster = [annihilape()];
    expect(rankSecondMoves(roster, bosses, { minimumGain: 0.99 })).toHaveLength(0);
  });
});
