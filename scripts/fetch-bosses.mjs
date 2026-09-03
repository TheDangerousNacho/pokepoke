// Refreshes src/data/bosses.json — the current raid rotation.
// Pokebattler's /raids endpoint lists live bosses per tier, which beats
// hand-transcribing Leek Duck. Edit the JSON by hand afterwards if needed.
// Run: npm run fetch:bosses
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/bosses.json');
const GM = resolve(ROOT, 'src/data/gamemaster.json');
const SOURCE = 'https://fight.pokebattler.com/raids';

// Pokebattler tier id -> our tier key. Anything not listed is skipped, which
// drops their _LEGACY / _FUTURE duplicates and the Dynamax tiers.
const TIER_MAP = {
  RAID_LEVEL_1: '1',
  RAID_LEVEL_3: '3',
  RAID_LEVEL_4: '4',
  RAID_LEVEL_5: '5',
  RAID_LEVEL_6: '6',
  RAID_LEVEL_MEGA: 'MEGA',
  RAID_LEVEL_MEGA_5: 'MEGA_LEGENDARY',
  RAID_LEVEL_ELITE: 'ELITE',
  RAID_LEVEL_3_SHADOW: 'SHADOW_3',
  RAID_LEVEL_5_SHADOW: 'SHADOW_5',
};

const gm = JSON.parse(await readFile(GM, 'utf8'));

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
const { tiers } = await res.json();

/**
 * Pokebattler names forms differently from the Game Master: `_MEGA` suffixes
 * instead of a temp-evolution on the base species, `_SHADOW_FORM` instead of a
 * flag, and `_FORM` tacked onto regional names. Normalise to our keys.
 */
function normalise(pokebattlerId) {
  if (pokebattlerId.endsWith('_MEGA')) {
    const base = pokebattlerId.slice(0, -'_MEGA'.length);
    return { speciesId: base, megaId: 'TEMP_EVOLUTION_MEGA' };
  }
  for (const [a, b] of [['_MEGA_X', 'TEMP_EVOLUTION_MEGA_X'], ['_MEGA_Y', 'TEMP_EVOLUTION_MEGA_Y']]) {
    if (pokebattlerId.endsWith(a)) return { speciesId: pokebattlerId.slice(0, -a.length), megaId: b };
  }
  if (pokebattlerId.endsWith('_SHADOW_FORM')) {
    // Shadow is already implied by the SHADOW_* tier; the species is the base.
    return { speciesId: pokebattlerId.slice(0, -'_SHADOW_FORM'.length) };
  }
  if (pokebattlerId.endsWith('_FORM')) {
    return { speciesId: pokebattlerId.slice(0, -'_FORM'.length) };
  }
  return { speciesId: pokebattlerId };
}

const bosses = [];
const unknown = [];
for (const t of tiers) {
  const tier = TIER_MAP[t.tier];
  if (!tier) continue;
  for (const raid of t.raids ?? []) {
    const { speciesId, megaId } = normalise(raid.pokemon);
    const species = gm.species[speciesId];
    if (!species || (megaId && !species.megas.some((m) => m.id === megaId))) {
      unknown.push(`${raid.pokemon} (${t.tier})`);
      continue;
    }
    if (bosses.some((b) => b.speciesId === speciesId && b.megaId === megaId && b.tier === tier)) continue;
    bosses.push({
      speciesId,
      ...(megaId ? { megaId } : {}),
      tier,
      shiny: Boolean(raid.shiny),
      // Movesets are not part of the rotation feed. The UI defaults to the
      // species' first available moves and lets the user change them.
      fastMove: species.fastMoves[0] ?? null,
      chargedMove: species.chargedMoves[0] ?? null,
    });
  }
}

bosses.sort((a, b) => a.tier.localeCompare(b.tier) || a.speciesId.localeCompare(b.speciesId));
await writeFile(OUT, `${JSON.stringify({ fetchedAt: new Date().toISOString(), source: SOURCE, bosses }, null, 2)}\n`);

console.log(`wrote ${OUT} — ${bosses.length} bosses`);
const byTier = {};
for (const b of bosses) (byTier[b.tier] ??= []).push(b.speciesId);
for (const [tier, list] of Object.entries(byTier)) console.log(`  ${tier.padEnd(15)} ${list.join(', ')}`);
if (unknown.length) console.log(`  skipped (not in game master): ${unknown.join(', ')}`);
