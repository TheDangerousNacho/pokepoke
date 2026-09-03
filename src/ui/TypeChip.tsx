import type { PokemonType } from '../engine/types';

/**
 * The community-standard type colours. People who play this game read these
 * faster than they read the words, which is the whole point of colouring them.
 */
const TYPE_COLOURS: Record<PokemonType, string> = {
  NORMAL: '#9fa19f',
  FIGHTING: '#ff8000',
  FLYING: '#81b9ef',
  POISON: '#9141cb',
  GROUND: '#915121',
  ROCK: '#afa981',
  BUG: '#91a119',
  GHOST: '#704170',
  STEEL: '#60a1b8',
  FIRE: '#e62829',
  WATER: '#2980ef',
  GRASS: '#3fa129',
  ELECTRIC: '#fac000',
  PSYCHIC: '#ef4179',
  ICE: '#3dcef3',
  DRAGON: '#5060e1',
  DARK: '#50413f',
  FAIRY: '#ef70ef',
};

/**
 * Black or white, whichever is readable on the given colour.
 *
 * Derived rather than hand-listed: several of these sit near the boundary
 * (Electric's yellow needs black, Fighting's orange is borderline), and a
 * second hand-maintained column would drift out of step with the first.
 * Uses the sRGB relative luminance from WCAG.
 */
function readableTextOn(hex: string): string {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  return luminance > 0.42 ? '#1a1a1a' : '#ffffff';
}

export function TypeChip({ type }: { type: string }) {
  const colour = TYPE_COLOURS[type as PokemonType];
  if (!colour) return <span className="type">{type}</span>;

  return (
    <span className="type" style={{ background: colour, color: readableTextOn(colour), borderColor: 'transparent' }}>
      {type}
    </span>
  );
}
