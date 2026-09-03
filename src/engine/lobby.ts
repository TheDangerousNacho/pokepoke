import { gm } from './gamemaster';
import {
  simulateParty, type DamageSample, type PartySimulation, type SimOptions,
} from './simulate';
import { getTier } from './raidTiers';
import type { RaidBossSpec, RosterEntry } from './stats';
import type { PokemonType } from './types';

export interface LobbyTrainer {
  id: string;
  name: string;
  party: RosterEntry[];
}

export interface TrainerContribution {
  id: string;
  name: string;
  sim: PartySimulation;
  /** Fraction of the lobby's total damage this trainer dealt. */
  share: number;
}

export interface LobbySimulation {
  trainers: TrainerContribution[];
  /** Combined cumulative damage across everyone. */
  combined: DamageSample[];
  totalDamage: number;
  bossHp: number;
  timerMs: number;
  /** Types boosted by a mega in the lobby, empty if nobody brought one. */
  megaBoostTypes: PokemonType[];
  won: boolean;
  timeToWinMs: number | null;
  /** Fraction of the boss's HP removed by the deadline. 1 means a win. */
  bossHpFraction: number;
}

/**
 * Types boosted by megas anywhere in the lobby.
 *
 * A mega boosts every attacker in the raid, not just its owner's, so this is
 * genuinely a property of the lobby rather than of one party. Where several
 * megas are present their boosted types are unioned — the game applies the
 * best available boost per type, and with only one boost tier in the data
 * that reduces to "any mega of this type is present".
 */
export function deriveMegaBoostTypes(trainers: LobbyTrainer[]): PokemonType[] {
  const types = new Set<PokemonType>();
  for (const trainer of trainers) {
    for (const entry of trainer.party) {
      if (!entry.megaId) continue;
      const species = gm.species[entry.speciesId];
      const mega = species?.megas.find((m) => m.id === entry.megaId);
      for (const type of mega?.types ?? []) types.add(type);
    }
  }
  return [...types];
}

/**
 * Cumulative damage at time `t` from a curve of samples.
 *
 * The curves are event-driven, so different trainers have samples at different
 * instants and cannot be summed index by index. Each is a step function: the
 * value at `t` is the last sample at or before it.
 */
function damageAt(samples: DamageSample[], t: number, cursor: { i: number }): number {
  while (cursor.i + 1 < samples.length && samples[cursor.i + 1].timeMs <= t) cursor.i++;
  return samples[cursor.i].cumulativeDamage;
}

/**
 * Simulates a raid with each trainer bringing their own Pokémon.
 *
 * The boss attacks every trainer independently in Pokémon GO — each player's
 * client runs its own fight against the same shared HP pool — so simulating
 * each party separately and summing their damage is the faithful model, not a
 * shortcut. The one genuine interaction between parties is the mega boost,
 * which is derived from the whole lobby and applied to everyone.
 *
 * This replaces the earlier assumption that every trainer brings a copy of
 * your party, which overstated a mixed household lobby by around 1.7x.
 */
export function simulateLobby(
  trainers: LobbyTrainer[],
  boss: RaidBossSpec,
  options: SimOptions = {},
): LobbySimulation {
  const active = trainers.filter((t) => t.party.length > 0);
  if (active.length === 0) throw new Error('lobby has no trainers with Pokémon');

  const megaBoostTypes = deriveMegaBoostTypes(active);
  const conditions = {
    ...options.conditions,
    // An explicit override wins; otherwise use what the lobby actually brought.
    megaBoostTypes: options.conditions?.megaBoostTypes ?? megaBoostTypes,
  };

  const sims = active.map((t) => simulateParty(t.party, boss, { ...options, conditions }));
  const tier = getTier(boss.tier);
  const timerMs = tier.timerSeconds * 1000;

  // Merge the step functions onto the union of their sample times.
  const times = [...new Set(sims.flatMap((s) => s.samples.map((sample) => sample.timeMs)))]
    .sort((a, b) => a - b);
  const cursors = sims.map(() => ({ i: 0 }));

  const combined: DamageSample[] = [];
  let timeToWinMs: number | null = null;
  for (const t of times) {
    let total = 0;
    for (let i = 0; i < sims.length; i++) total += damageAt(sims[i].samples, t, cursors[i]);
    combined.push({ timeMs: t, cumulativeDamage: total });
    if (timeToWinMs === null && total >= tier.bossHp) timeToWinMs = t;
  }

  const totalDamage = combined.at(-1)?.cumulativeDamage ?? 0;

  return {
    trainers: active.map((t, i) => ({
      id: t.id,
      name: t.name,
      sim: sims[i],
      share: totalDamage > 0 ? sims[i].totalDamage / totalDamage : 0,
    })),
    combined,
    totalDamage,
    bossHp: tier.bossHp,
    timerMs,
    megaBoostTypes,
    won: timeToWinMs !== null,
    timeToWinMs,
    bossHpFraction: Math.min(1, totalDamage / tier.bossHp),
  };
}

/**
 * Builds a lobby of `count` copies of one party.
 *
 * Kept for the single-profile case, where "could three of us do this" really
 * does mean three people like you. Named so the assumption is visible at the
 * call site rather than buried in a group-size argument.
 */
export function identicalLobby(party: RosterEntry[], count: number, name = 'Trainer'): LobbyTrainer[] {
  if (count < 1) throw new Error(`count must be at least 1, got ${count}`);
  return Array.from({ length: count }, (_, i) => ({
    id: `clone-${i}`,
    name: count === 1 ? name : `${name} ${i + 1}`,
    party,
  }));
}
