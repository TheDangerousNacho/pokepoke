import { gm } from '../engine/gamemaster';

/** SHADOW_CLAW_FAST -> Shadow Claw. Game Master ids are not human-facing. */
export function moveName(id: string): string {
  return id
    .replace(/_FAST$/, '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

/** MAROWAK_ALOLA -> Marowak (Alola). Base forms lose nothing. */
export function speciesName(id: string): string {
  const species = gm.species[id];
  const title = (s: string) =>
    s.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

  if (!species) return title(id);
  if (!species.form) return title(species.pokemonId);

  const suffix = species.form.startsWith(`${species.pokemonId}_`)
    ? species.form.slice(species.pokemonId.length + 1)
    : species.form;
  return `${title(species.pokemonId)} (${title(suffix)})`;
}

export function megaName(id: string): string {
  const label = id.replace('TEMP_EVOLUTION_', '').replace(/_/g, ' ');
  return label === 'MEGA' ? 'Mega' : `Mega ${label.replace('MEGA ', '')}`;
}

export function formatSeconds(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
