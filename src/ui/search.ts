import { gm } from '../engine/gamemaster';
import { speciesName } from './format';

export interface SpeciesOption {
  id: string;
  name: string;
  dex: number;
  types: string[];
}

/**
 * Every attackable species, sorted by dex. Built once — the picker filters
 * this list rather than rebuilding it per keystroke.
 *
 * "Attackable" excludes the handful of forms the Game Master gives no moves
 * at all (Smeargle, whose moves come from Sketch). They cannot be simulated
 * as an attacker or as a boss, so offering them would only produce a crash
 * further down.
 */
export const ALL_SPECIES: SpeciesOption[] = Object.values(gm.species)
  .filter((s) => s.fastMoves.length > 0 && s.chargedMoves.length > 0)
  .map((s) => ({ id: s.id, name: speciesName(s.id), dex: s.dex, types: s.types }))
  .sort((a, b) => a.dex - b.dex || a.name.localeCompare(b.name));

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Substring search over display names, ranked so exact and prefix matches beat
 * mid-word ones. Deliberately simple: the Game Master's ids are inconsistent
 * (base forms are `GIRATINA`, variants `GIRATINA_ORIGIN`), so searching the
 * *display* name is what makes both findable by typing "giratina".
 */
export function searchSpecies(query: string, limit = 50): SpeciesOption[] {
  const q = normalise(query);
  if (!q) return ALL_SPECIES.slice(0, limit);

  const scored: Array<{ option: SpeciesOption; score: number }> = [];
  for (const option of ALL_SPECIES) {
    const name = normalise(option.name);
    const at = name.indexOf(q);
    if (at === -1) continue;
    scored.push({ option, score: name === q ? 0 : at === 0 ? 1 : 2 + at });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.option.dex - b.option.dex)
    .slice(0, limit)
    .map((s) => s.option);
}
