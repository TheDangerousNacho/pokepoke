import { damage, energyFromDamageTaken, type BattleConditions } from './damage';
import { gm, getMove } from './gamemaster';
import { getTier } from './raidTiers';
import { buildAttacker, buildBoss, type Combatant, type RaidBossSpec, type RosterEntry } from './stats';

export interface SimOptions {
  conditions?: BattleConditions;
  /**
   * Extra delay added after each of the player's moves, modelling imperfect
   * input. Defaults to 0.
   *
   * Careful with this: it is a flat cost per MOVE, not per second, so it
   * punishes short fast moves hardest. At 500ms it halves the output of a
   * 1000ms fast move like Bullet Punch, which is not a realistic penalty.
   * Anything above ~100ms should be treated as a deliberate pessimism knob.
   */
  attackDelayMs?: number;
  /** Time lost re-entering the lobby after the whole party faints. */
  relobbyMs?: number;
}

const DEFAULTS = { attackDelayMs: 0, relobbyMs: 10_000 } as const;

/** A point on the cumulative-damage curve for one trainer. */
export interface DamageSample {
  timeMs: number;
  cumulativeDamage: number;
}

export interface PartySimulation {
  /** Cumulative damage one trainer deals over the full timer. */
  samples: DamageSample[];
  totalDamage: number;
  /** How many of the trainer's Pokémon fainted. */
  deaths: number;
  timerMs: number;
  bossHp: number;
  /** Damage per second averaged over the whole timer, faints included. */
  dps: number;
}

interface ActorState {
  combatant: Combatant;
  hp: number;
  energy: number;
  readyAt: number;
}

interface PendingHit {
  at: number;
  fromPlayer: boolean;
  amount: number;
}

function makeActor(c: Combatant, at: number): ActorState {
  return { combatant: c, hp: c.hp, energy: 0, readyAt: at };
}

/** Charged move if the energy is there, otherwise the fast move. */
function chooseMove(actor: ActorState) {
  const charged = getMove(actor.combatant.chargedMove);
  if (actor.energy >= Math.abs(charged.energy)) return charged;
  return getMove(actor.combatant.fastMove);
}

/**
 * Simulates ONE trainer's party against the boss for the full raid timer,
 * recording the cumulative-damage curve rather than stopping at a kill.
 *
 * Recording the curve instead of a single time-to-win is what makes group
 * sizes cheap: because boss HP is fixed regardless of lobby size, N trainers
 * is just N copies of this curve, and time-to-win is the first point where
 * N x cumulative damage clears the boss's HP. See `timeToWin`.
 *
 * Deliberate simplifications, all of which make this an *under*estimate of
 * what a skilled player achieves:
 *  - No dodging. Every boss hit lands in full.
 *  - The boss acts on a fixed cycle rather than the randomised timing the
 *    real client uses, so its damage is smooth instead of spiky.
 *  - Both sides use their charged move the instant energy allows.
 */
export function simulateParty(
  party: RosterEntry[],
  bossSpec: RaidBossSpec,
  options: SimOptions = {},
): PartySimulation {
  if (party.length === 0) throw new Error('party is empty');

  const attackDelayMs = options.attackDelayMs ?? DEFAULTS.attackDelayMs;
  const relobbyMs = options.relobbyMs ?? DEFAULTS.relobbyMs;
  const conditions = options.conditions ?? {};

  const tier = getTier(bossSpec.tier);
  const timerMs = tier.timerSeconds * 1000;
  const boss = buildBoss(bossSpec);

  const roster = party.map(buildAttacker);
  let slot = 0;
  let player = makeActor(roster[slot], 0);
  const bossActor = makeActor(boss, gm.settings.enemyAttackIntervalS * 1000);

  const samples: DamageSample[] = [{ timeMs: 0, cumulativeDamage: 0 }];
  const pending: PendingHit[] = [];
  let cumulative = 0;
  let deaths = 0;
  let t = 0;

  const nextEvent = () => {
    let next = Infinity;
    if (player.readyAt < next) next = player.readyAt;
    if (bossActor.readyAt < next) next = bossActor.readyAt;
    for (const h of pending) if (h.at < next) next = h.at;
    return next;
  };

  /** Fire a move: schedule its hit and put the actor on cooldown. */
  const act = (actor: ActorState, target: ActorState, fromPlayer: boolean) => {
    const move = chooseMove(actor);
    const dealt = damage(actor.combatant, target.combatant, move, fromPlayer ? conditions : {});

    pending.push({ at: t + Math.min(move.damageWindowStartMs, move.durationMs), fromPlayer, amount: dealt });
    actor.energy = Math.min(gm.settings.maxEnergy, actor.energy + move.energy);
    actor.readyAt = t + move.durationMs + (fromPlayer ? attackDelayMs : gm.settings.enemyAttackIntervalS * 1000);
  };

  while (t < timerMs) {
    const next = nextEvent();
    if (!Number.isFinite(next)) break;
    t = Math.max(t, next);
    if (t >= timerMs) break;

    // Resolve every hit landing at this instant before anyone acts again.
    for (let i = pending.length - 1; i >= 0; i--) {
      const hit = pending[i];
      if (hit.at > t) continue;
      pending.splice(i, 1);

      if (hit.fromPlayer) {
        cumulative += hit.amount;
        samples.push({ timeMs: hit.at, cumulativeDamage: cumulative });
        // The boss builds energy from damage taken, which is what makes its
        // charged moves land when they do.
        bossActor.energy = Math.min(gm.settings.maxEnergy, bossActor.energy + energyFromDamageTaken(hit.amount));
      } else {
        player.hp -= hit.amount;
        player.energy = Math.min(gm.settings.maxEnergy, player.energy + energyFromDamageTaken(hit.amount));
      }
    }

    // Handle a faint before letting anyone act.
    if (player.hp <= 0) {
      deaths++;
      slot++;
      if (slot >= roster.length) {
        // Whole party down: revive and rejoin, losing the relobby time.
        slot = 0;
        player = makeActor(roster[slot], t + relobbyMs);
      } else {
        player = makeActor(roster[slot], t + gm.settings.swapDurationMs);
      }
      // Hits already in flight toward the fainted Pokémon are discarded.
      for (let i = pending.length - 1; i >= 0; i--) if (!pending[i].fromPlayer) pending.splice(i, 1);
      continue;
    }

    if (player.readyAt <= t && player.hp > 0) act(player, bossActor, true);
    if (bossActor.readyAt <= t) act(bossActor, player, false);
  }

  samples.push({ timeMs: timerMs, cumulativeDamage: cumulative });

  return {
    samples,
    totalDamage: cumulative,
    deaths,
    timerMs,
    bossHp: tier.bossHp,
    dps: cumulative / (timerMs / 1000),
  };
}

export interface WinEstimate {
  trainers: number;
  won: boolean;
  /** Milliseconds to bring the boss down, or null if the timer runs out. */
  timeToWinMs: number | null;
  /** Fraction of the boss's HP removed by the deadline. 1 means a win. */
  bossHpFraction: number;
}

/**
 * Time for `trainers` identical copies of this party to clear the boss.
 *
 * Valid because boss HP does not scale with lobby size: more trainers add
 * damage without adding HP. It assumes every trainer brings the same party,
 * which for a household planning tool is the intended reading of
 * "can the three of us do this".
 */
export function timeToWin(sim: PartySimulation, trainers: number): WinEstimate {
  if (trainers < 1) throw new Error(`trainers must be at least 1, got ${trainers}`);

  for (const s of sim.samples) {
    if (s.cumulativeDamage * trainers >= sim.bossHp) {
      return { trainers, won: true, timeToWinMs: s.timeMs, bossHpFraction: 1 };
    }
  }
  return {
    trainers,
    won: false,
    timeToWinMs: null,
    bossHpFraction: Math.min(1, (sim.totalDamage * trainers) / sim.bossHp),
  };
}

export interface AttackerRating {
  speciesId: string;
  name: string;
  fastMove: string;
  chargedMove: string;
  /** Damage per second while alive. */
  dps: number;
  /** Total damage output before fainting — how much this Pokémon contributes. */
  tdo: number;
  /** Seconds survived against the boss. */
  survivalSeconds: number;
}

/**
 * Rates a single Pokémon against a boss by running it alone until it faints
 * or the timer expires. DPS and TDO come from the same run, so a glass cannon
 * and a bulky attacker are compared on the terms that matter in a raid.
 */
export function rateAttacker(
  entry: RosterEntry,
  bossSpec: RaidBossSpec,
  options: SimOptions = {},
): AttackerRating {
  const sim = simulateParty([entry], bossSpec, { ...options, relobbyMs: Number.MAX_SAFE_INTEGER });
  const attacker = buildAttacker(entry);

  // With no relobby the run ends at the first faint. Survival time is the
  // FIRST moment the damage total was reached, not the last sample carrying
  // it — every later sample repeats the same total until the timer.
  const reached = sim.samples.find((s) => s.cumulativeDamage === sim.totalDamage);
  const survivalMs = sim.deaths > 0 && reached ? reached.timeMs : sim.timerMs;

  return {
    speciesId: entry.speciesId,
    name: attacker.name,
    fastMove: entry.fastMove,
    chargedMove: entry.chargedMove,
    dps: sim.totalDamage / (survivalMs / 1000),
    tdo: sim.totalDamage,
    survivalSeconds: survivalMs / 1000,
  };
}

/** Rates every Pokémon in a roster against one boss, best DPS first. */
export function rankAttackers(
  roster: RosterEntry[],
  bossSpec: RaidBossSpec,
  options: SimOptions = {},
): AttackerRating[] {
  return roster
    .map((entry) => rateAttacker(entry, bossSpec, options))
    .sort((a, b) => b.dps - a.dps);
}
