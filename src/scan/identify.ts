import { combatPower, cpm } from '../engine/cpm';
import { gm } from '../engine/gamemaster';
import { matchSpeciesName } from './match';
import type { PokemonType } from '../engine/types';

export interface StatsMatch {
  speciesId: string;
  /** Levels at which some IV spread reproduces both the CP and the HP. */
  levels: number[];
}

const MAX_LEVEL = 51;
const IV_VALUES = Array.from({ length: 16 }, (_, i) => i);

/**
 * Identifies a Pokémon from its CP and HP.
 *
 * This exists because a renamed Pokémon shows only its nickname — the species
 * name appears nowhere on the detail screen, so no amount of OCR tuning will
 * recover it. CP and HP together are a much stronger constraint than either
 * alone: HP pins stamina and level, and CP then constrains attack and defense.
 *
 * The test is exact, not fuzzy: a species qualifies only if some integer IV
 * spread in 0-15 reproduces both numbers exactly at some level. That is the
 * same arithmetic an IV calculator runs, and it beats assuming a hundo with a
 * tolerance bolted on — which drops genuine low-IV Pokémon entirely.
 *
 * IMPORTANT: this is a FILTER, not a guess. Many species share a CP/HP pair,
 * and nothing here ranks one above another — there is no honest likelihood
 * signal to rank by, and an early attempt to invent one (preferring species
 * that fit in fewer ways) simply buried common Pokémon under obscure ones.
 * Results come back in Pokédex order for scanning, and the caller must present
 * them as "it could be one of these", never as an answer.
 *
 * Type badges and the candy label are the real discriminators. The candy is
 * named after the family's base species ("EEVEE CANDY" on a renamed Sylveon),
 * which is the one species fact a renamed Pokémon cannot hide.
 */
export function identifyFromStats(
  cp: number,
  hp: number,
  { types, familyId, limit = 60 }: {
    types?: PokemonType[];
    /** Evolutionary family from the candy label — the strongest filter available. */
    familyId?: string | null;
    limit?: number;
  } = {},
): StatsMatch[] {
  if (!Number.isInteger(cp) || !Number.isInteger(hp) || cp < 10 || hp < 10) return [];

  const out: StatsMatch[] = [];

  for (const species of Object.values(gm.species)) {
    if (types?.length && !types.every((t) => species.types.includes(t))) continue;
    if (familyId && species.familyId !== familyId) continue;

    const levels: number[] = [];

    for (let level = 1; level <= MAX_LEVEL; level += 0.5) {
      const multiplier = cpm(level);

      // HP depends only on stamina, so it pins the stamina IVs outright.
      const staminaIvs = IV_VALUES.filter(
        (iv) => Math.floor((species.baseStamina + iv) * multiplier) === hp,
      );
      if (staminaIvs.length === 0) {
        // Even a 0 IV already overshoots: no higher level can work either.
        if (Math.floor((species.baseStamina + 0) * multiplier) > hp) break;
        continue;
      }

      const fits = staminaIvs.some((stamina) =>
        IV_VALUES.some((attack) =>
          IV_VALUES.some(
            (defense) => combatPower(species, { attack, defense, stamina }, level) === cp,
          ),
        ),
      );
      if (fits) levels.push(level);
    }

    if (levels.length > 0) out.push({ speciesId: species.id, levels });
  }

  // Pokédex order: predictable and scannable. Deliberately not "ranked".
  const byDex = (id: string) => gm.species[id].dex;
  return out.sort((a, b) => byDex(a.speciesId) - byDex(b.speciesId)).slice(0, limit);
}

/** Type names as they appear on the detail screen's badges. */
const TYPE_WORDS = new Set<string>(gm.types);

/**
 * Reads type badges out of OCR text. They sit under the name as plain words,
 * so when they survive OCR they cut the candidate list down sharply — which
 * matters most for exactly the renamed Pokémon that have no name to match.
 */
export function parseTypes(text: string): PokemonType[] {
  const found = new Set<PokemonType>();
  for (const word of text.toUpperCase().split(/[^A-Z]+/)) {
    if (TYPE_WORDS.has(word)) found.add(word as PokemonType);
  }
  // More than two means we matched prose, not the badges.
  return found.size <= 2 ? [...found] : [];
}

/**
 * Reads the evolutionary family from the candy label.
 *
 * The detail screen shows "<BASE SPECIES> CANDY", named for the base of the
 * family rather than the Pokémon itself — so a renamed Sylveon still displays
 * "EEVEE CANDY". That makes it the strongest species signal available when the
 * name has been replaced by a nickname.
 */
export function parseCandyFamily(text: string): string | null {
  // The label sits among other words ("STARDUST EEVEE CANDY EEVEE CANDY XL"),
  // so anchor on CANDY and walk backwards a word at a time rather than trying
  // to capture the name in one greedy group — that swallowed "STARDUST EEVEE".
  const words = text.replace(/[^A-Za-z0-9'.\-\s]/g, ' ').split(/\s+/).filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    if (words[i].toUpperCase() !== 'CANDY') continue;

    // Try the single preceding word first, then two, for names like "Mr Mime".
    for (const take of [1, 2]) {
      const start = i - take;
      if (start < 0) continue;
      const phrase = words.slice(start, i).join(' ');
      const [best] = matchSpeciesName(phrase, 1);
      if (best && best.score >= 0.85) {
        return gm.species[best.species.id]?.familyId ?? null;
      }
    }
  }
  return null;
}
