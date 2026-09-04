import { describe, expect, it } from 'vitest';
import { MAX_LEVEL } from '../cpm';
import { rateAttacker, simulateParty } from '../simulate';
import { bestBuddyLevel, buildAttacker, withBuddyBoost, type RaidBossSpec, type RosterEntry } from '../stats';

const ivs = { attack: 15, defense: 15, stamina: 15 };
const mon = (speciesId: string, fastMove: string, chargedMove: string, extra: Partial<RosterEntry> = {}): RosterEntry => ({
  speciesId, level: 40, ivs, fastMove, chargedMove, ...extra,
});

const machamp = (extra: Partial<RosterEntry> = {}) => mon('MACHAMP', 'COUNTER_FAST', 'DYNAMIC_PUNCH', extra);
const metagross = (extra: Partial<RosterEntry> = {}) => mon('METAGROSS', 'BULLET_PUNCH_FAST', 'METEOR_MASH', extra);

const regirock: RaidBossSpec = {
  speciesId: 'REGIROCK', tier: '5', fastMove: 'ROCK_THROW_FAST', chargedMove: 'STONE_EDGE',
};

describe('the Best Buddy bonus', () => {
  it('is one level, capped at the top of the CPM table', () => {
    expect(bestBuddyLevel(40)).toBe(41);
    expect(bestBuddyLevel(50)).toBe(51);
    expect(bestBuddyLevel(MAX_LEVEL)).toBe(MAX_LEVEL);
  });

  it('raises the attack stat of the Pokémon it lands on', () => {
    const [boosted] = withBuddyBoost([machamp({ isBestBuddy: true })], ['ROCK']);
    expect(boosted.level).toBe(41);
    expect(buildAttacker(boosted).attack).toBeGreaterThan(buildAttacker(machamp()).attack);
  });

  it('goes to only ONE Pokémon, however many are Best Buddies', () => {
    const party = [machamp({ isBestBuddy: true }), metagross({ isBestBuddy: true }), machamp({ isBestBuddy: true })];
    const boosted = withBuddyBoost(party, ['ROCK']);
    expect(boosted.filter((e) => e.level > 40)).toHaveLength(1);
    // The flag is consumed so a second pass cannot boost anyone again.
    expect(boosted.some((e) => e.isBestBuddy)).toBe(false);
    expect(withBuddyBoost(boosted, ['ROCK']).filter((e) => e.level > 40)).toHaveLength(1);
  });

  it('gives it to whichever Best Buddy does the most damage to THIS boss', () => {
    const pair = () => [metagross({ isBestBuddy: true }), machamp({ isBestBuddy: true })];
    const boostedAgainst = (types: 'DARK' | 'GHOST') =>
      withBuddyBoost(pair(), [types]).find((e) => e.level > 40)?.speciesId;

    // Fighting is super effective on Dark and useless against Ghost, so the
    // buddy you would walk in with changes with the boss — which is the point
    // of choosing rather than taking the first one in the party.
    expect(boostedAgainst('DARK')).toBe('MACHAMP');
    expect(boostedAgainst('GHOST')).toBe('METAGROSS');
  });

  it('leaves a party with no Best Buddies untouched', () => {
    const party = [machamp(), metagross()];
    expect(withBuddyBoost(party, ['ROCK'])).toBe(party);
  });

  it('makes a party hit harder, but only by one Pokémon\'s worth', () => {
    const plain = [machamp(), machamp()];
    const one = [machamp({ isBestBuddy: true }), machamp()];
    const both = [machamp({ isBestBuddy: true }), machamp({ isBestBuddy: true })];

    const damage = (party: RosterEntry[]) => simulateParty(party, regirock).totalDamage;
    expect(damage(one)).toBeGreaterThan(damage(plain));
    expect(damage(both)).toBe(damage(one));
  });

  it('applies to a Pokémon rated on its own, which is trivially your buddy', () => {
    const boosted = rateAttacker(machamp({ isBestBuddy: true }), regirock);
    expect(boosted.dps).toBeGreaterThan(rateAttacker(machamp(), regirock).dps);
  });
});
