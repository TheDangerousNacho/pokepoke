import { gm, getSpecies } from './gamemaster';
import { bestMoveset } from './moveset';
import { rankAttackers, type SimOptions } from './simulate';
import { buildBoss, type RaidBossSpec, type RosterEntry } from './stats';
import type { PokemonType, Rarity } from './types';

/** A candidate the user could go and get, with what it would do for them. */
export interface BenchCandidate {
  speciesId: string;
  fastMove: string;
  chargedMove: string;
  /** DPS as a level-40 15/15/15 build, from the same simulation as your own. */
  dps: number;
  /** Already somewhere in the roster — power it up rather than hunt a new one. */
  owned: boolean;
  rarity: Rarity;
}

export interface BenchGap {
  boss: RaidBossSpec;
  /** Your best attacker against this boss, or null when the roster is empty. */
  best: { speciesId: string; dps: number } | null;
  /**
   * What a level-40 15/15/15 build of the best *farmable* species manages.
   * Legendaries are deliberately not the yardstick: measuring every roster
   * against Mewtwo would tell everyone the same thing, and the number would
   * stop reflecting anything the user can change.
   */
  ceilingDps: number;
  /** best / ceiling. 1 means your bench is as good as this fight gets. */
  coverage: number;
  /** Better than your best, nearest first. Empty when nothing would help. */
  candidates: BenchCandidate[];
}

/**
 * The standard a candidate is measured at. Level 40 and perfect IVs is not
 * what you would first catch, but it is what the Pokémon becomes, and it is
 * the same yardstick for every candidate — the comparison is between species,
 * not between two people's luck.
 */
const CANDIDATE_LEVEL = 40;
const CANDIDATE_IVS = { attack: 15, defense: 15, stamina: 15 };

/** How many species get a full simulation per boss, after the cheap shortlist. */
const SHORTLIST = 40;

/**
 * Mythicals are excluded outright: they come from timed research, are usually
 * one per account, and cannot be farmed, so naming one is not advice. Raid
 * legendaries and Ultra Beasts stay in — going and raiding one is exactly the
 * action this list exists to prompt — but they are labelled, and they do not
 * set the bar the coverage number is measured against.
 */
const EXCLUDED: Rarity[] = ['MYTHIC'];
const FARMABLE: Rarity[] = ['NORMAL'];

/**
 * Forms that exist in the Game Master but are not Pokémon anyone can field:
 * mid-battle transformations from the main series that Pokémon GO does not
 * implement. There is no data signal for this — the dump marks them
 * deployable and tradable like every other form — so this is a judgement
 * call, deliberately kept to forms that actually rank highly enough to be
 * suggested. If GO ever releases one, delete it from this list.
 */
const BATTLE_ONLY_FORMS = new Set(['DARMANITAN_ZEN', 'DARMANITAN_GALARIAN_ZEN', 'PALAFIN_HERO']);

/**
 * Candidates offered per boss: a couple you could go and catch, plus the best
 * raid legendary. A list that is all legendaries reads as "you cannot win",
 * and a list with no legendaries hides the fastest way to actually improve.
 */
const FARMABLE_SUGGESTIONS = 2;
const RARE_SUGGESTIONS = 1;

/**
 * Cheap first pass: rank every species by closed-form cycle DPS against this
 * boss's types. Memoised by type combination, because a rotation routinely has
 * several bosses that defend identically.
 */
const shortlists = new Map<string, string[]>();

function shortlistFor(defenderTypes: PokemonType[]): string[] {
  const key = defenderTypes.join('/');
  const cached = shortlists.get(key);
  if (cached) return cached;

  const scored: Array<{ id: string; dps: number }> = [];
  for (const species of Object.values(gm.species)) {
    // Elite moves are excluded, matching how a new roster entry is defaulted:
    // suggesting a species for a move that costs an Elite TM would be advice
    // most people cannot act on.
    if (EXCLUDED.includes(species.rarity)) continue;
    if (BATTLE_ONLY_FORMS.has(species.id)) continue;
    const best = bestMoveset(species.id, defenderTypes);
    if (best) scored.push({ id: species.id, dps: best.dps });
  }

  const ids = scored
    .sort((a, b) => b.dps - a.dps)
    .slice(0, SHORTLIST)
    .map((s) => s.id);
  shortlists.set(key, ids);
  return ids;
}

/** A shortlisted species as the roster entry it would eventually become. */
function candidateEntry(speciesId: string, defenderTypes: PokemonType[]): RosterEntry | null {
  const best = bestMoveset(speciesId, defenderTypes);
  if (!best) return null;
  return {
    speciesId,
    level: CANDIDATE_LEVEL,
    ivs: CANDIDATE_IVS,
    fastMove: best.fastMove,
    chargedMove: best.chargedMove,
  };
}

/**
 * Picks the shopping list: the best few farmable species, plus the best raid
 * legendary, each only if it actually beats what the user already fields.
 */
function pickCandidates(
  rated: Array<{ speciesId: string; fastMove: string; chargedMove: string; dps: number }>,
  yourBest: number,
  owned: Set<string>,
): BenchCandidate[] {
  const better = rated.filter((r) => r.dps > yourBest);
  const isFarmable = (id: string) => FARMABLE.includes(getSpecies(id).rarity);

  const chosen = [
    ...better.filter((r) => isFarmable(r.speciesId)).slice(0, FARMABLE_SUGGESTIONS),
    ...better.filter((r) => !isFarmable(r.speciesId)).slice(0, RARE_SUGGESTIONS),
  ].sort((a, b) => b.dps - a.dps);

  return chosen.map((r) => ({
    speciesId: r.speciesId,
    fastMove: r.fastMove,
    chargedMove: r.chargedMove,
    dps: r.dps,
    owned: owned.has(r.speciesId),
    rarity: getSpecies(r.speciesId).rarity,
  }));
}

/**
 * What the roster is missing, boss by boss.
 *
 * The Upgrades tab answers "is this moveset worth a TM" for Pokémon you have.
 * This answers the other half — which fights you are simply not equipped for,
 * and what to go and catch or raid for. Both sides run through the same
 * simulation, so a candidate's DPS is comparable to your own attacker's rather
 * than being a different kind of number.
 */
export function findBenchGaps(
  roster: RosterEntry[],
  bosses: RaidBossSpec[],
  options: SimOptions = {},
): BenchGap[] {
  const owned = new Set(roster.map((e) => e.speciesId));

  return bosses
    .map((boss): BenchGap => {
      const defenderTypes = buildBoss(boss).types;

      const mine = rankAttackers(roster, boss, options);
      const best = mine.length > 0 ? { speciesId: mine[0].speciesId, dps: mine[0].dps } : null;

      const rated = shortlistFor(defenderTypes)
        .map((id) => candidateEntry(id, defenderTypes))
        .filter((e): e is RosterEntry => e !== null)
        .map((entry) => rankAttackers([entry], boss, options)[0])
        .sort((a, b) => b.dps - a.dps);

      const farmable = rated.filter((r) => FARMABLE.includes(getSpecies(r.speciesId).rarity));
      const ceilingDps = farmable.length > 0 ? farmable[0].dps : rated[0]?.dps ?? 0;

      return {
        boss,
        best,
        ceilingDps,
        coverage: best && ceilingDps > 0 ? Math.min(1, best.dps / ceilingDps) : 0,
        candidates: pickCandidates(rated, best?.dps ?? 0, owned),
      };
    })
    .sort((a, b) => a.coverage - b.coverage);
}
