import { gm } from './gamemaster';
import { simulateParty, type SimOptions } from './simulate';
import type { LobbyTrainer } from './lobby';
import { simulateLobby } from './lobby';
import type { RaidBossSpec, RosterEntry } from './stats';

export interface UpgradeBill {
  stardust: number;
  candy: number;
  /** XL candy, which is far scarcer than the ordinary kind. */
  xlCandy: number;
}

const ZERO: UpgradeBill = { stardust: 0, candy: 0, xlCandy: 0 };

const add = (a: UpgradeBill, b: UpgradeBill): UpgradeBill => ({
  stardust: a.stardust + b.stardust,
  candy: a.candy + b.candy,
  xlCandy: a.xlCandy + b.xlCandy,
});

/** Highest level a power-up can reach. Best buddy adds one more, but that is
 *  not something you buy, so it is not part of a cost plan. */
export const MAX_POWER_UP_LEVEL = 50;

/**
 * Cost of powering up from one level to another.
 *
 * Two details the raw tables do not make obvious. The cost arrays are indexed
 * by whole level minus one, and `upgradesPerLevel` is 2 — so a whole level is
 * two payments at the same rate, and a half level is one. Above level 40 the
 * ordinary candy column goes to zero and XL candy takes over, which is why
 * they are reported separately: stardust is abundant, XL candy is not.
 */
export function upgradeCost(
  fromLevel: number,
  toLevel: number,
  { isShadow = false, isPurified = false }: { isShadow?: boolean; isPurified?: boolean } = {},
): UpgradeBill {
  if (toLevel <= fromLevel) return { ...ZERO };
  if (toLevel > MAX_POWER_UP_LEVEL) throw new Error(`cannot power up past ${MAX_POWER_UP_LEVEL}`);

  const costs = gm.upgradeCosts;
  const dustMultiplier = isShadow
    ? costs.shadowStardustMultiplier
    : isPurified ? costs.purifiedStardustMultiplier : 1;
  const candyMultiplier = isShadow
    ? costs.shadowCandyMultiplier
    : isPurified ? costs.purifiedCandyMultiplier : 1;

  let bill = { ...ZERO };
  // One payment per half-level step, priced by the whole level you start from.
  for (let level = fromLevel; level < toLevel; level += 0.5) {
    const i = Math.floor(level) - 1;
    const stardust = costs.stardust[i];
    if (stardust === undefined) throw new Error(`no upgrade cost for level ${level}`);

    const usesXl = Math.floor(level) >= costs.xlCandyMinPokemonLevel;
    bill = add(bill, {
      stardust: Math.round(stardust * dustMultiplier),
      candy: usesXl ? 0 : Math.round((costs.candy[i] ?? 0) * candyMultiplier),
      xlCandy: usesXl ? Math.round((costs.xlCandy[Math.floor(level) - costs.xlCandyMinPokemonLevel] ?? 0) * candyMultiplier) : 0,
    });
  }
  return bill;
}

export interface PowerUpStep {
  trainerId: string;
  trainerName: string;
  speciesId: string;
  /** Index within that trainer's party. */
  memberIndex: number;
  fromLevel: number;
  toLevel: number;
  cost: UpgradeBill;
  /** Extra damage the lobby deals as a result of this step. */
  damageGain: number;
}

export interface PowerUpPlan {
  /** True when nothing needs doing — the lobby already wins. */
  alreadyWinning: boolean;
  /** False when even maxing everyone out is not enough. */
  achievable: boolean;
  steps: PowerUpStep[];
  total: UpgradeBill;
  /** Boss HP fraction the plan reaches, 1 meaning a win. */
  finalFraction: number;
}

/**
 * Jumps considered for each Pokémon on each pass.
 *
 * NOT half-levels. Damage is floored per hit, so a single half-level very often
 * changes no integer damage at all — an earlier version stepped by 0.5, scored
 * every candidate at zero gain, and confidently reported that nothing could be
 * done. Candidates have to be big enough to move a floored number.
 *
 * Kept small at the top end too. Allowing eight-level jumps let a single weak
 * Pokémon win one round on raw dust-efficiency and absorb the entire budget —
 * the planner's first instruction was to spend 393,000 dust taking a Magmar to
 * level 48. Larger moves still emerge when the same Pokémon is chosen
 * repeatedly, and those get merged into one instruction.
 */
const LEVEL_JUMPS = [1, 2, 3];

/**
 * Finds a cheap set of power-ups that turns a losing raid into a winnable one.
 *
 * Greedy on damage per stardust: repeatedly apply whichever power-up buys the
 * most damage per dust, until the lobby wins. Greedy rather than optimal on
 * purpose — the exact problem is a knapsack over correlated items, and the
 * difference is not worth the runtime for advice acted on one power-up at a
 * time.
 *
 * Ranking by stardust rather than by damage is what makes it useful: a level at
 * 40 costs several times what the same level costs at 25, so ranking on raw
 * gain would keep pointing at the expensive end of the roster.
 */
export function planPowerUps(
  trainers: LobbyTrainer[],
  boss: RaidBossSpec,
  {
    /**
     * Safety valve, not a tuning knob. The search normally ends when the raid
     * is won or nothing helps; this only stops a pathological case looping.
     * It counts internal passes, and each merged instruction usually takes
     * several, so it needs to be generous — at 40 the planner gave up partway
     * and reported a winnable raid as unachievable.
     */
    maxSteps = 200,
    ...options
  }: SimOptions & { maxSteps?: number } = {},
): PowerUpPlan {
  const start = simulateLobby(trainers, boss, options);
  if (start.won) {
    return { alreadyWinning: true, achievable: true, steps: [], total: { ...ZERO }, finalFraction: 1 };
  }

  // Check the ceiling before planning anything. If maxing every Pokémon still
  // loses, no sequence of power-ups helps, and listing a million stardust of
  // futile spending would be worse than saying so — the honest answer is that
  // this lobby needs different Pokémon or another body, not more levels.
  const maxed = simulateLobby(
    trainers.map((t) => ({
      ...t,
      party: t.party.map((e) => ({ ...e, level: MAX_POWER_UP_LEVEL })),
    })),
    boss,
    options,
  );
  if (!maxed.won) {
    return {
      alreadyWinning: false,
      achievable: false,
      steps: [],
      total: { ...ZERO },
      finalFraction: maxed.bossHpFraction,
    };
  }

  // Work on a mutable copy; each trainer's damage depends only on their own
  // party, so a candidate can be priced by re-simulating one party.
  const parties = trainers.map((t) => ({ ...t, party: t.party.map((e) => ({ ...e })) }));
  const conditions = { ...options.conditions, megaBoostTypes: start.megaBoostTypes };
  const simOf = (party: RosterEntry[]) =>
    simulateParty(party, boss, { ...options, conditions }).totalDamage;

  const current = parties.map((t) => simOf(t.party));
  let total = current.reduce((a, b) => a + b, 0);
  const raw: PowerUpStep[] = [];

  for (let step = 0; step < maxSteps && total < start.bossHp; step++) {
    let best: {
      ti: number; mi: number; gain: number; cost: UpgradeBill; value: number; toLevel: number;
    } | null = null;

    for (let ti = 0; ti < parties.length; ti++) {
      for (let mi = 0; mi < parties[ti].party.length; mi++) {
        const member = parties[ti].party[mi];

        // The ceiling is always a candidate. Without it the search can stall
        // short of a win it has already verified is reachable: near the top,
        // flooring means no 1-3 level jump changes the damage even though a
        // larger one does.
        const targets = [
          ...LEVEL_JUMPS.map((j) => Math.min(member.level + j, MAX_POWER_UP_LEVEL)),
          MAX_POWER_UP_LEVEL,
        ];

        for (const toLevel of new Set(targets)) {
          if (toLevel <= member.level) continue;

          const cost = upgradeCost(member.level, toLevel, { isShadow: member.isShadow });
          if (cost.stardust <= 0) continue;

          const trial = parties[ti].party.map((e, i) => (i === mi ? { ...e, level: toLevel } : e));
          const gain = simOf(trial) - current[ti];
          if (gain <= 0) continue;

          const value = gain / cost.stardust;
          if (!best || value > best.value) best = { ti, mi, gain, cost, value, toLevel };
        }
      }
    }

    if (!best) break; // nothing left that helps

    const member = parties[best.ti].party[best.mi];
    const fromLevel = member.level;
    member.level = best.toLevel;
    current[best.ti] += best.gain;
    total += best.gain;

    raw.push({
      trainerId: parties[best.ti].id,
      trainerName: parties[best.ti].name,
      speciesId: member.speciesId,
      memberIndex: best.mi,
      fromLevel,
      toLevel: member.level,
      cost: best.cost,
      damageGain: best.gain,
    });
  }

  // Half-level steps on the same Pokémon read as noise; present them as one
  // move from where it is now to where it should be.
  const steps: PowerUpStep[] = [];
  for (const s of raw) {
    const previous = steps.find(
      (p) => p.trainerId === s.trainerId && p.memberIndex === s.memberIndex,
    );
    if (previous) {
      previous.toLevel = s.toLevel;
      previous.cost = add(previous.cost, s.cost);
      previous.damageGain += s.damageGain;
    } else {
      steps.push({ ...s });
    }
  }

  return {
    alreadyWinning: false,
    achievable: total >= start.bossHp,
    steps,
    total: steps.reduce((a, s) => add(a, s.cost), { ...ZERO }),
    finalFraction: Math.min(1, total / start.bossHp),
  };
}
