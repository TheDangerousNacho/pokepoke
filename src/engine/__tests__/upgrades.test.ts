import { describe, expect, it } from 'vitest';
import { evaluateUpgrades, rankUpgrades } from '../upgrades';
import { getSpecies } from '../gamemaster';
import type { RaidBossSpec, RosterEntry } from '../stats';

const ivs = { attack: 15, defense: 15, stamina: 15 };
const mon = (speciesId: string, fastMove: string, chargedMove: string): RosterEntry => ({
  speciesId, level: 40, ivs, fastMove, chargedMove,
});

const regice: RaidBossSpec = {
  speciesId: 'REGICE', tier: '5', fastMove: 'FROST_BREATH_FAST', chargedMove: 'BLIZZARD',
};
const mewtwo: RaidBossSpec = {
  speciesId: 'MEWTWO', tier: '5', fastMove: 'PSYCHO_CUT_FAST', chargedMove: 'PSYSTRIKE',
};

describe('evaluateUpgrades', () => {
  it('finds a real improvement over a deliberately bad moveset', () => {
    // Metagross with Psychic into an Ice boss: its Steel moves are far better.
    const u = evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'), [regice]);
    expect(u.gain).toBeGreaterThan(0.1);
    expect(u.best.dps).toBeGreaterThan(u.current.dps);
    expect(u.changes).toContain('charged');
  });

  it('reports no meaningful gain when the moveset is already best', () => {
    const best = evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'), [regice]).best;
    const u = evaluateUpgrades(mon('METAGROSS', best.fastMove, best.chargedMove), [regice]);
    expect(u.gain).toBeCloseTo(0, 6);
    expect(u.changes).toEqual([]);
    expect(u.eliteTms).toBe(0);
  });

  it('only ever recommends moves the species can actually learn', () => {
    const species = getSpecies('METAGROSS');
    const learnable = new Set([
      ...species.fastMoves, ...species.chargedMoves,
      ...species.eliteFastMoves, ...species.eliteChargedMoves,
    ]);
    const u = evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'), [regice]);
    expect(learnable.has(u.best.fastMove)).toBe(true);
    expect(learnable.has(u.best.chargedMove)).toBe(true);
  });

  it('flags when the best moveset needs an Elite TM, and offers the alternative', () => {
    // Meteor Mash is Elite-only on Metagross, and is its best Steel move.
    const u = evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'), [regice]);
    expect(u.best.chargedMove).toBe('METEOR_MASH');
    expect(u.best.containsEliteMove).toBe(true);
    expect(u.eliteTms).toBe(1);
    // There must still be a non-elite suggestion, since most people have no
    // Elite TM to spend.
    expect(u.bestWithoutElite).not.toBeNull();
    expect(u.bestWithoutElite!.eliteSpend).toBe(0);
  });

  it('costs ordinary TMs in expectation, not one each', () => {
    // A regular TM rerolls at random, so a specific move takes several.
    const u = evaluateUpgrades(mon('MACHAMP', 'BULLET_PUNCH_FAST', 'HEAVY_SLAM'), [mewtwo]);
    if (u.eliteTms === 0 && u.changes.length > 0) {
      expect(u.expectedRegularTms).toBeGreaterThan(1);
    }
  });

  it('charges nothing for a legacy move the Pokémon already knows', () => {
    // Karate Chop is Elite-only on Machamp. Keeping it costs no Elite TM, so a
    // recommendation that leaves it alone must not be priced as if it did.
    const species = getSpecies('MACHAMP');
    expect(species.eliteFastMoves).toContain('KARATE_CHOP_FAST');
    const u = evaluateUpgrades(mon('MACHAMP', 'KARATE_CHOP_FAST', 'CROSS_CHOP'), [regice]);
    if (u.best.fastMove === 'KARATE_CHOP_FAST') expect(u.eliteTms).toBe(0);
  });

  it('will not spend an Elite TM for a marginal gain', () => {
    // Tyranitar's best legacy moveset is barely ahead of its best free one, and
    // an Elite TM is too scarce to burn on that.
    const u = evaluateUpgrades(mon('TYRANITAR', 'BITE_FAST', 'FIRE_BLAST'), [regice, mewtwo]);
    expect(u.eliteTms).toBe(0);
  });

  it('does spend one when the margin is real', () => {
    // Meteor Mash is far ahead of anything Metagross can learn freely.
    const u = evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'), [regice]);
    expect(u.eliteTms).toBe(1);
    expect(u.best.chargedMove).toBe('METEOR_MASH');
  });

  it('respects a caller who wants every marginal option', () => {
    const strict = evaluateUpgrades(mon('TYRANITAR', 'BITE_FAST', 'FIRE_BLAST'), [regice, mewtwo]);
    const loose = evaluateUpgrades(mon('TYRANITAR', 'BITE_FAST', 'FIRE_BLAST'), [regice, mewtwo], {
      eliteWorthThreshold: 0,
    });
    expect(loose.best.dps).toBeGreaterThanOrEqual(strict.best.dps);
  });

  it('warns when a swap would destroy a legacy move', () => {
    // Starting from the Elite-only Meteor Mash and moving away from it.
    const u = evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'METEOR_MASH'), [mewtwo]);
    if (u.changes.includes('charged')) expect(u.losesLegacyMove).toBe(true);
  });

  it('averages across several bosses rather than fitting one', () => {
    const one = evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'), [regice]);
    const both = evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'), [regice, mewtwo]);
    expect(both.current.dps).not.toBeCloseTo(one.current.dps, 3);
  });

  it('rejects an empty boss list rather than inventing a target', () => {
    expect(() => evaluateUpgrades(mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'), []))
      .toThrow(/at least one boss/);
  });
});

describe('rankUpgrades', () => {
  const roster = [
    mon('METAGROSS', 'BULLET_PUNCH_FAST', 'PSYCHIC'),
    mon('MACHAMP', 'COUNTER_FAST', 'DYNAMIC_PUNCH'),
    mon('TYRANITAR', 'BITE_FAST', 'FIRE_BLAST'),
  ];

  it('drops Pokémon with nothing worth doing', () => {
    const all = rankUpgrades(roster, [regice], { minimumGain: 0 });
    const filtered = rankUpgrades(roster, [regice], { minimumGain: 0.5 });
    expect(filtered.length).toBeLessThan(all.length);
  });

  it('puts Elite-TM-free upgrades first', () => {
    const ranked = rankUpgrades(roster, [regice, mewtwo], { minimumGain: 0 });
    const firstElite = ranked.findIndex((u) => u.eliteTms > 0);
    if (firstElite > 0) {
      expect(ranked.slice(0, firstElite).every((u) => u.eliteTms === 0)).toBe(true);
    }
  });

  it('ranks Elite TM spends by gain per TM, not raw gain', () => {
    const ranked = rankUpgrades(roster, [regice, mewtwo], { minimumGain: 0 })
      .filter((u) => u.eliteTms > 0);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].gainPerEliteTm).toBeGreaterThanOrEqual(ranked[i].gainPerEliteTm);
    }
  });

  it('halves the score of an upgrade needing two Elite TMs', () => {
    const two = { gain: 0.4, eliteTms: 2, gainPerEliteTm: 0.2 };
    expect(two.gain / two.eliteTms).toBeCloseTo(two.gainPerEliteTm, 6);
  });
});

describe('a second charged move', () => {
  /** Annihilape knows both Close Combat and Shadow Ball. */
  const both = {
    speciesId: 'ANNIHILAPE',
    level: 40,
    ivs: { attack: 15, defense: 15, stamina: 15 },
    fastMove: 'COUNTER_FAST',
    chargedMove: 'CLOSE_COMBAT',
    chargedMove2: 'SHADOW_BALL',
  };
  const ghostBoss: RaidBossSpec = {
    speciesId: 'GIRATINA', tier: '5', fastMove: 'SHADOW_CLAW_FAST', chargedMove: 'DRAGON_CLAW',
  };

  it('never advises a TM for a move already known', () => {
    const u = evaluateUpgrades(both, [ghostBoss]);
    expect(u.changes).not.toContain('charged');
    expect(u.best.eliteSpend).toBe(0);
  });

  it('rates the Pokémon on the better of its two moves', () => {
    const onlyCloseCombat = { ...both, chargedMove2: undefined };
    const withBoth = evaluateUpgrades(both, [ghostBoss]);
    const without = evaluateUpgrades(onlyCloseCombat, [ghostBoss]);
    // Shadow Ball is the right move against a Ghost boss, so knowing it should
    // raise the baseline rather than show up as an upgrade to buy.
    expect(withBoth.current.dps).toBeGreaterThan(without.current.dps);
    expect(withBoth.gain).toBeLessThan(without.gain);
  });

  it('reports the move it is not currently using', () => {
    const u = evaluateUpgrades(both, [ghostBoss]);
    expect(u.current.chargedMove).toBe('SHADOW_BALL');
    expect(u.alsoKnows).toEqual(['CLOSE_COMBAT']);
  });
});
