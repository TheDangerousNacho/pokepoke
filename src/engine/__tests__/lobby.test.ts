import { describe, expect, it } from 'vitest';
import { deriveMegaBoostTypes, identicalLobby, simulateLobby } from '../lobby';
import { simulateParty, timeToWin } from '../simulate';
import type { LobbyTrainer } from '../lobby';
import type { RaidBossSpec, RosterEntry } from '../stats';

const iv = (n: number) => ({ attack: n, defense: n, stamina: n });
const mon = (speciesId: string, fastMove: string, chargedMove: string, level = 40, n = 15): RosterEntry =>
  ({ speciesId, level, ivs: iv(n), fastMove, chargedMove });

const regice: RaidBossSpec = {
  speciesId: 'REGICE', tier: '5', fastMove: 'FROST_BREATH_FAST', chargedMove: 'BLIZZARD',
};

const strong = [
  mon('METAGROSS', 'BULLET_PUNCH_FAST', 'METEOR_MASH'),
  mon('MACHAMP', 'COUNTER_FAST', 'DYNAMIC_PUNCH'),
];
const weak = [
  mon('MACHOKE', 'KARATE_CHOP_FAST', 'CROSS_CHOP', 20, 8),
  mon('GRAVELER', 'MUD_SLAP_FAST', 'STONE_EDGE', 20, 8),
];

const trainer = (id: string, party: RosterEntry[]): LobbyTrainer => ({ id, name: id, party });

describe('simulateLobby', () => {
  it('sums damage across differently-equipped trainers', () => {
    const lobby = simulateLobby([trainer('a', strong), trainer('b', weak)], regice);
    const alone = simulateParty(strong, regice).totalDamage;
    const other = simulateParty(weak, regice).totalDamage;
    expect(lobby.totalDamage).toBeCloseTo(alone + other, 0);
  });

  it('reports each trainer’s share', () => {
    const lobby = simulateLobby([trainer('strong', strong), trainer('weak', weak)], regice);
    const shares = Object.fromEntries(lobby.trainers.map((t) => [t.id, t.share]));
    expect(shares.strong).toBeGreaterThan(shares.weak);
    expect(shares.strong + shares.weak).toBeCloseTo(1, 6);
  });

  it('agrees with the identical-copies model when everyone is identical', () => {
    // The old model is a special case of the new one, so they must not diverge.
    const sim = simulateParty(strong, regice);
    const old = timeToWin(sim, 3);
    const lobby = simulateLobby(identicalLobby(strong, 3), regice);
    expect(lobby.won).toBe(old.won);
    if (old.won) expect(lobby.timeToWinMs).toBeCloseTo(old.timeToWinMs!, 0);
    else expect(lobby.bossHpFraction).toBeCloseTo(old.bossHpFraction, 3);
  });

  it('shows a mixed lobby is much weaker than three copies of the best team', () => {
    // The whole reason this exists: assuming everyone brings your team badly
    // overstates a real household.
    const optimistic = simulateLobby(identicalLobby(strong, 3), regice);
    const real = simulateLobby(
      [trainer('a', strong), trainer('b', weak), trainer('c', weak)],
      regice,
    );
    expect(real.totalDamage).toBeLessThan(optimistic.totalDamage * 0.75);
  });

  it('produces a monotonic combined curve ending at the total', () => {
    const lobby = simulateLobby([trainer('a', strong), trainer('b', weak)], regice);
    let prev = -1;
    for (const s of lobby.combined) {
      expect(s.cumulativeDamage).toBeGreaterThanOrEqual(prev);
      prev = s.cumulativeDamage;
    }
    expect(lobby.combined.at(-1)!.cumulativeDamage).toBe(lobby.totalDamage);
  });

  it('merges curves by time, not by sample index', () => {
    // Parties of different sizes emit different numbers of samples; summing
    // index-wise would silently misalign them.
    const a = trainer('a', strong);
    const b = trainer('b', [...weak, mon('MAGMAR', 'EMBER_FAST', 'FIRE_BLAST', 20, 8)]);
    const lobby = simulateLobby([a, b], regice);
    const sa = simulateParty(a.party, regice);
    const sb = simulateParty(b.party, regice);
    expect(sa.samples.length).not.toBe(sb.samples.length);
    expect(lobby.totalDamage).toBeCloseTo(sa.totalDamage + sb.totalDamage, 0);
  });

  it('never reports a win time beyond the timer', () => {
    const lobby = simulateLobby(identicalLobby(strong, 6), regice);
    if (lobby.won) expect(lobby.timeToWinMs).toBeLessThanOrEqual(lobby.timerMs);
  });

  it('rejects an empty lobby', () => {
    expect(() => simulateLobby([], regice)).toThrow(/no trainers/);
    expect(() => simulateLobby([trainer('a', [])], regice)).toThrow(/no trainers/);
  });
});

describe('deriveMegaBoostTypes', () => {
  it('finds a mega anywhere in the lobby', () => {
    const withMega = [{ ...mon('CHARIZARD', 'FIRE_SPIN_FAST', 'BLAST_BURN'), megaId: 'TEMP_EVOLUTION_MEGA_Y' }];
    expect(deriveMegaBoostTypes([trainer('a', strong), trainer('b', withMega)]))
      .toEqual(expect.arrayContaining(['FIRE', 'FLYING']));
  });

  it('is empty when nobody brought one', () => {
    expect(deriveMegaBoostTypes([trainer('a', strong)])).toEqual([]);
  });

  it('boosts everyone, not just the mega’s owner', () => {
    const megaCharizard = { ...mon('CHARIZARD', 'FIRE_SPIN_FAST', 'BLAST_BURN'), megaId: 'TEMP_EVOLUTION_MEGA_Y' };
    // A Fire attacker in someone else's party should benefit.
    const fireTeam = [mon('BLAZIKEN', 'FIRE_SPIN_FAST', 'BLAST_BURN')];
    const without = simulateLobby([trainer('a', fireTeam)], regice).totalDamage;
    const with_ = simulateLobby([trainer('a', fireTeam), trainer('b', [megaCharizard])], regice);
    const megaOwnerAlone = with_.trainers.find((t) => t.id === 'b')!.sim.totalDamage;
    const boostedTeammate = with_.trainers.find((t) => t.id === 'a')!.sim.totalDamage;
    expect(boostedTeammate).toBeGreaterThan(without);
    expect(megaOwnerAlone).toBeGreaterThan(0);
  });

  it('lets an explicit override win over what the lobby brought', () => {
    const megaCharizard = { ...mon('CHARIZARD', 'FIRE_SPIN_FAST', 'BLAST_BURN'), megaId: 'TEMP_EVOLUTION_MEGA_Y' };
    const lobby = [trainer('a', strong), trainer('b', [megaCharizard])];
    const derived = simulateLobby(lobby, regice);
    const overridden = simulateLobby(lobby, regice, { conditions: { megaBoostTypes: ['STEEL'] } });
    expect(derived.totalDamage).not.toBeCloseTo(overridden.totalDamage, 0);
  });
});

describe('identicalLobby', () => {
  it('builds the requested number of copies', () => {
    expect(identicalLobby(strong, 3)).toHaveLength(3);
    expect(identicalLobby(strong, 1)[0].name).toBe('Trainer');
  });

  it('rejects a nonsensical count', () => {
    expect(() => identicalLobby(strong, 0)).toThrow(/at least 1/);
  });
});
