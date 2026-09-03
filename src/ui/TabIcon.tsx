/**
 * Small glyphs for the tab bar.
 *
 * Inline SVG rather than an icon font or a sprite sheet: five shapes is not
 * worth a dependency or a network request, and these have to render offline.
 * `currentColor` so they follow the active/inactive tab colour for free.
 */
const PATHS: Record<string, string> = {
  // A target, matching the app icon.
  boss: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z',
  // Stacked cards: a list of Pokémon.
  roster: 'M4 5h16v3H4V5Zm0 5.5h16v3H4v-3ZM4 16h16v3H4v-3Z',
  // A camera.
  scan: 'M9 4h6l1.2 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.8L9 4Zm3 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z',
  // A bar chart.
  results: 'M4 19h3V10H4v9Zm6.5 0h3V5h-3v14ZM17 19h3v-6h-3v6Z',
  // Two arrows swapping: a move change. Keyed by tab id, not label.
  upgrades: 'M7 7h9l-2.3-2.3L15.1 3.3 20 8.2l-4.9 4.9-1.4-1.4L16 9.4H7V7Zm10 8H8l2.3 2.3-1.4 1.4L4 14.2l4.9-4.9 1.4 1.4L8 13h9v2Z',
};

export function TabIcon({ name }: { name: string }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}
