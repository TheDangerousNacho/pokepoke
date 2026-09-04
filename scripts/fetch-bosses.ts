// Refreshes src/data/bosses.json — the raid rotation shipped with the build,
// so a fresh install is not empty before anyone presses Refresh in the app.
//
// The parsing lives in src/data/rotation.ts and is shared with the app, so
// there is one implementation to keep correct. Run: npm run fetch:bosses
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gm } from '../src/engine/gamemaster.ts';
import { fetchRotation, ROTATION_SOURCE } from '../src/data/rotation.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/bosses.json');

const { bosses, skipped } = await fetchRotation(gm.species);

await writeFile(
  OUT,
  `${JSON.stringify({ fetchedAt: new Date().toISOString(), source: ROTATION_SOURCE, bosses }, null, 2)}\n`,
);

console.log(`wrote ${OUT} — ${bosses.length} bosses`);
const byTier: Record<string, string[]> = {};
for (const b of bosses) {
  (byTier[b.tier] ??= []).push(b.megaId ? `${b.speciesId} (${b.megaId.replace('TEMP_EVOLUTION_', '')})` : b.speciesId);
}
for (const [tier, list] of Object.entries(byTier)) console.log(`  ${tier.padEnd(15)} ${list.join(', ')}`);
if (skipped.length) console.log(`  skipped (not in game master): ${skipped.join(', ')}`);
