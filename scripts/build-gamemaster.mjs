// Reduces the 19MB PokeMiners Game Master dump to a compact bundle the app ships.
// Run: npm run build:gm
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = resolve(ROOT, 'data/vendor/latest.json');
const OUT = resolve(ROOT, 'src/data/gamemaster.json');

// Pinned so a mid-project Niantic update can't silently change our numbers.
// Bump deliberately, then re-run the engine test suite.
const PIN = {
  repo: 'PokeMiners/game_masters',
  commit: '8e227be44f288d34463e23bf04e9b564d3c16f79',
  path: 'latest/latest.json',
  committed: '2026-08-29T12:08:01Z',
};
const URL_ = `https://raw.githubusercontent.com/${PIN.repo}/${PIN.commit}/${PIN.path}`;

// Index order of `typeEffective.attackScalar`. Not stated in the dump, so it is
// asserted against known matchups below rather than trusted.
const TYPES = [
  'NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK',
  'BUG', 'GHOST', 'STEEL', 'FIRE', 'WATER', 'GRASS',
  'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK', 'FAIRY',
];

const shortType = (t) => t.replace('POKEMON_TYPE_', '');

async function ensureVendor() {
  try {
    await stat(VENDOR);
    return;
  } catch {
    /* not downloaded yet */
  }
  console.log(`downloading game master @ ${PIN.commit.slice(0, 8)} ...`);
  await mkdir(dirname(VENDOR), { recursive: true });
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(VENDOR));
}

function buildTypeChart(templates) {
  const chart = {};
  for (const t of templates) {
    const te = t.data.typeEffective;
    if (!te) continue;
    chart[shortType(te.attackType)] = te.attackScalar;
  }
  const missing = TYPES.filter((t) => !chart[t]);
  if (missing.length) throw new Error(`type chart missing rows: ${missing}`);

  // Guard against the attackScalar index order changing under us.
  const expect = [
    ['FIRE', 'GRASS', 1.6], ['FIRE', 'WATER', 0.625], ['FIRE', 'STEEL', 1.6],
    ['WATER', 'FIRE', 1.6], ['GROUND', 'ELECTRIC', 1.6], ['GROUND', 'FLYING', 0.390625],
    ['NORMAL', 'GHOST', 0.390625], ['FIGHTING', 'FAIRY', 0.625], ['DRAGON', 'FAIRY', 0.390625],
    ['PSYCHIC', 'DARK', 0.390625], ['GHOST', 'NORMAL', 0.390625], ['BUG', 'PSYCHIC', 1.6],
  ];
  for (const [atk, def, want] of expect) {
    const got = chart[atk][TYPES.indexOf(def)];
    if (Math.abs(got - want) > 1e-9) {
      throw new Error(`type order assertion failed: ${atk}->${def} was ${got}, expected ${want}`);
    }
  }
  return chart;
}

function buildMoves(templates) {
  const moves = {};
  // Species can reference a move by its numeric movementId instead of its name.
  const byNumericId = new Map();
  for (const t of templates) {
    const m = t.data.moveSettings;
    if (!m) continue;
    // A couple dozen entries carry a numeric movementId; the templateId always
    // holds the name species reference, so derive from that.
    const id = /^V\d+_MOVE_(.+)$/.exec(t.templateId)?.[1];
    if (!id) continue;
    const energy = m.energyDelta ?? 0;
    // Fast moves gain energy, charged moves spend it. A handful of unused or
    // special-cased entries (STRUGGLE, TRANSFORM_FAST, GULP_MISSILE_*) sit at
    // zero, so fall back to the name for those.
    const isFast = energy !== 0 ? energy > 0 : id.includes('_FAST');
    if (energy !== 0 && isFast !== id.includes('_FAST')) {
      throw new Error(`${id}: energy ${energy} disagrees with the move name`);
    }
    if (typeof m.movementId === 'number') byNumericId.set(m.movementId, id);
    moves[id] = {
      id,
      type: shortType(m.pokemonType),
      category: isFast ? 'fast' : 'charged',
      power: m.power ?? 0,
      energy,
      durationMs: m.durationMs,
      damageWindowStartMs: m.damageWindowStartMs ?? 0,
      damageWindowEndMs: m.damageWindowEndMs ?? m.durationMs,
    };
  }
  return { moves, byNumericId };
}

// Costume and `_NORMAL` forms duplicate the base entry exactly. Keep only forms
// that actually differ in something the engine reads.
const battleSignature = (p) =>
  JSON.stringify([
    p.stats?.baseAttack, p.stats?.baseDefense, p.stats?.baseStamina,
    p.type, p.type2,
    [...(p.quickMoves ?? [])].sort(), [...(p.cinematicMoves ?? [])].sort(),
    [...(p.eliteQuickMove ?? [])].sort(), [...(p.eliteCinematicMove ?? [])].sort(),
  ]);

function buildSpecies(templates, resolveMove) {
  const byId = new Map();
  for (const t of templates) {
    const p = t.data.pokemonSettings;
    if (!p?.stats?.baseAttack) continue;
    const dex = Number(/^V(\d+)_POKEMON_/.exec(t.templateId)?.[1] ?? 0);
    if (!byId.has(p.pokemonId)) byId.set(p.pokemonId, []);
    byId.get(p.pokemonId).push({ dex, form: p.form ?? null, p });
  }

  const species = {};
  for (const [pokemonId, entries] of byId) {
    const base = entries.find((e) => e.form === null) ?? entries[0];
    const baseSig = battleSignature(base.p);
    const keep = [base, ...entries.filter((e) => e !== base && battleSignature(e.p) !== baseSig)];

    // Two distinct forms can still share a signature (e.g. cosmetic pairs); dedupe again.
    const seen = new Set();
    for (const e of keep) {
      const sig = battleSignature(e.p);
      if (e !== base && seen.has(sig)) continue;
      seen.add(sig);

      const p = e.p;
      const id = e === base ? pokemonId : e.form;
      species[id] = {
        id,
        pokemonId,
        form: e.form,
        dex: e.dex,
        // FAMILY_CHARMANDER etc. The candy on the detail screen is named after
        // the family's base species, which is the only species signal a renamed
        // Pokémon leaves on screen.
        familyId: p.familyId ?? null,
        types: [shortType(p.type), p.type2 ? shortType(p.type2) : null].filter(Boolean),
        baseAttack: p.stats.baseAttack,
        baseDefense: p.stats.baseDefense,
        baseStamina: p.stats.baseStamina,
        fastMoves: (p.quickMoves ?? []).map(resolveMove),
        chargedMoves: (p.cinematicMoves ?? []).map(resolveMove),
        // Elite = obtainable only via Elite TM. Phase 3 must never recommend a
        // move that is in neither list.
        eliteFastMoves: (p.eliteQuickMove ?? []).map(resolveMove),
        eliteChargedMoves: (p.eliteCinematicMove ?? []).map(resolveMove),
        // Shadow-eligible species carry a `shadow` block in the dump.
        hasShadow: Boolean(p.shadow),
        megas: (p.tempEvoOverrides ?? [])
          .filter((o) => o.stats)
          .map((o) => ({
            id: o.tempEvoId,
            types: [
              shortType(o.typeOverride1 ?? p.type),
              (o.typeOverride2 ?? p.type2) ? shortType(o.typeOverride2 ?? p.type2) : null,
            ].filter(Boolean),
            baseAttack: o.stats.baseAttack,
            baseDefense: o.stats.baseDefense,
            baseStamina: o.stats.baseStamina,
          })),
      };
    }
  }
  return species;
}

function buildSettings(idx) {
  const b = idx.BATTLE_SETTINGS.battleSettings;
  const w = idx.WEATHER_BONUS_SETTINGS.weatherBonusSettings;
  const m = idx.MEGA_EVO_SETTINGS.megaEvoSettings;
  return {
    // A mega in the lobby boosts every attacker's damage, not just its owner's.
    megaBoostSameType: m.attackBoostFromMegaSameType,
    megaBoostDifferentType: m.attackBoostFromMegaDifferentType,
    stab: b.sameTypeAttackBonusMultiplier,
    weatherBonus: w.attackBonusMultiplier,
    shadowAttackMultiplier: b.shadowPokemonAttackBonusMultiplier,
    shadowDefenseMultiplier: b.shadowPokemonDefenseBonusMultiplier,
    maxEnergy: b.maximumEnergy,
    swapDurationMs: b.swapDurationMs,
    dodgeDurationMs: b.dodgeDurationMs,
    dodgeDamageReductionPercent: b.dodgeDamageReductionPercent,
    energyDeltaPerHealthLost: b.energyDeltaPerHealthLost,
    bossEnergyRegenerationPerHealthLost: b.bossEnergyRegenerationPerHealthLost,
    enemyAttackIntervalS: b.enemyAttackInterval,
    maximumAttackersPerBattle: b.maximumAttackersPerBattle,
  };
}

/** Weather condition -> the move types it boosts. */
function buildWeatherAffinities(templates) {
  const out = {};
  for (const t of templates) {
    const w = t.data.weatherAffinities;
    if (!w) continue;
    out[w.weatherCondition] = w.pokemonType.map(shortType);
  }
  if (Object.keys(out).length < 6) {
    throw new Error(`expected the full weather table, got ${Object.keys(out)}`);
  }
  return out;
}

function buildFriendship(templates) {
  const levels = templates
    .filter((t) => /^FRIENDSHIP_LEVEL_\d+$/.test(t.templateId))
    .sort((a, b) => a.templateId.localeCompare(b.templateId, undefined, { numeric: true }))
    .map((t) => t.data.friendshipMilestoneSettings.attackBonusPercentage ?? 1);
  if (levels.length < 5 || levels[0] !== 1) {
    throw new Error(`unexpected friendship table: ${JSON.stringify(levels)}`);
  }
  return levels; // index = friendship level, 0 = not friends
}

/**
 * Packs the bundle for shipping. Two things dominate the raw size: move names
 * repeated across every species that learns them (182KB), and JSON object keys
 * repeated 1194 times. So moves become integer indices into one id table, and
 * every record becomes a positional tuple. `unpack` in src/engine/gamemaster.ts
 * is the exact inverse.
 */
function pack(bundle) {
  const moveIds = Object.keys(bundle.moves);
  const familyIds = [...new Set(Object.values(bundle.species).map((s) => s.familyId).filter(Boolean))].sort();
  const familyIndex = new Map(familyIds.map((id, i) => [id, i]));
  const moveIndex = new Map(moveIds.map((id, i) => [id, i]));
  const typeIndex = new Map(bundle.types.map((t, i) => [t, i]));

  const ref = (id) => {
    const i = moveIndex.get(id);
    if (i === undefined) throw new Error(`move not in table: ${id}`);
    return i;
  };
  const t = (name) => {
    const i = typeIndex.get(name);
    if (i === undefined) throw new Error(`unknown type: ${name}`);
    return i;
  };

  const moves = moveIds.map((id) => {
    const m = bundle.moves[id];
    return [t(m.type), m.category === 'fast' ? 0 : 1, m.power, m.energy,
            m.durationMs, m.damageWindowStartMs, m.damageWindowEndMs];
  });

  const species = Object.values(bundle.species).map((s) => [
    s.id,
    // For a base form id === pokemonId and form is null; for a variant
    // id === form. So storing the base id only when it differs reconstructs
    // all three fields exactly.
    s.form === null ? null : s.pokemonId,
    s.dex,
    s.types.map(t),
    s.baseAttack, s.baseDefense, s.baseStamina,
    s.fastMoves.map(ref), s.chargedMoves.map(ref),
    s.eliteFastMoves.map(ref), s.eliteChargedMoves.map(ref),
    s.hasShadow ? 1 : 0,
    s.megas.map((m) => [m.id, m.types.map(t), m.baseAttack, m.baseDefense, m.baseStamina]),
    s.familyId === null ? -1 : familyIndex.get(s.familyId),
  ]);

  return {
    format: 3,
    source: bundle.source,
    types: bundle.types,
    typeChart: bundle.types.map((name) => bundle.typeChart[name]),
    cpMultipliers: bundle.cpMultipliers,
    settings: bundle.settings,
    friendshipAttackMultipliers: bundle.friendshipAttackMultipliers,
    weatherAffinities: Object.fromEntries(
      Object.entries(bundle.weatherAffinities).map(([k, v]) => [k, v.map(t)]),
    ),
    moveIds,
    familyIds,
    moves,
    species,
  };
}

async function main() {
  await ensureVendor();
  const templates = JSON.parse(await readFile(VENDOR, 'utf8'));
  const idx = Object.fromEntries(templates.map((t) => [t.templateId, t.data]));

  const { moves, byNumericId } = buildMoves(templates);
  const resolveMove = (ref) => {
    if (typeof ref === 'string') return ref;
    const name = byNumericId.get(ref);
    if (!name) throw new Error(`species references unknown numeric move id ${ref}`);
    return name;
  };

  const bundle = {
    source: { ...PIN, generatedAt: new Date().toISOString() },
    types: TYPES,
    typeChart: buildTypeChart(templates),
    cpMultipliers: idx.PLAYER_LEVEL_SETTINGS.playerLevel.cpMultiplier,
    settings: buildSettings(idx),
    friendshipAttackMultipliers: buildFriendship(templates),
    weatherAffinities: buildWeatherAffinities(templates),
    moves,
    species: buildSpecies(templates, resolveMove),
  };

  await mkdir(dirname(OUT), { recursive: true });
  const packed = pack(bundle);
  await writeFile(OUT, JSON.stringify(packed));
  const kb = ((await stat(OUT)).size / 1024).toFixed(0);

  const sp = Object.values(bundle.species);
  const mv = Object.values(bundle.moves);
  console.log(`wrote ${OUT} (${kb} KB)`);
  console.log(`  species ${sp.length} (${new Set(sp.map((s) => s.pokemonId)).size} base, ${sp.filter((s) => s.form).length} distinct forms)`);
  console.log(`  megas   ${sp.reduce((n, s) => n + s.megas.length, 0)}`);
  console.log(`  moves   ${mv.length} (${mv.filter((m) => m.category === 'fast').length} fast, ${mv.filter((m) => m.category === 'charged').length} charged)`);
  console.log(`  cpm levels 1..${bundle.cpMultipliers.length}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
