// Refreshes src/data/raidTiers.json from Pokebattler's public raid endpoint.
// Boss HP / CPM / timer are not in the PokeMiners dump, so they come from here.
// Run: npm run fetch:tiers
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/raidTiers.json');
const SOURCE = 'https://fight.pokebattler.com/raids';

/** Our tier keys -> Pokebattler's. Their list also carries _LEGACY/_FUTURE
 *  duplicates of every tier, which we ignore. */
const WANTED = {
  1: 'RAID_LEVEL_1',
  3: 'RAID_LEVEL_3',
  4: 'RAID_LEVEL_4',
  5: 'RAID_LEVEL_5',
  6: 'RAID_LEVEL_6',
  MEGA: 'RAID_LEVEL_MEGA',
  MEGA_LEGENDARY: 'RAID_LEVEL_MEGA_5',
  ELITE: 'RAID_LEVEL_ELITE',
  SHADOW_3: 'RAID_LEVEL_3_SHADOW',
  SHADOW_5: 'RAID_LEVEL_5_SHADOW',
};

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
const { tiers } = await res.json();
const byId = new Map(tiers.map((t) => [t.tier, t.info]));

const out = {};
for (const [key, pbTier] of Object.entries(WANTED)) {
  const info = byId.get(pbTier);
  if (!info) throw new Error(`Pokebattler no longer lists ${pbTier}`);
  if (!info.hp || !info.cpm || !info.combatTimeMs) {
    throw new Error(`${pbTier} is missing hp/cpm/combatTimeMs`);
  }
  out[key] = {
    pokebattlerTier: pbTier,
    bossHp: info.hp,
    bossCpm: Number(info.cpm.toFixed(7)),
    timerSeconds: info.combatTimeMs / 1000,
    label: key,
    soloable: info.soloable,
    nominalLevel: String(info.level),
  };
}

await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${OUT}`);
for (const [k, v] of Object.entries(out)) {
  console.log(`  ${k.padEnd(15)} hp=${String(v.bossHp).padStart(6)} cpm=${v.bossCpm} timer=${v.timerSeconds}s`);
}
