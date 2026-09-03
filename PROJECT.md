# Pokémon GO Raid & Team Planner

Personal tool answering two questions per raid boss:
1. What's the best team I have for this boss?
2. Can we (solo / duo / trio) realistically beat it?

Scaled-down household version of Pokebattler + Calcy IV. Not innovating on mechanics.

## Hard non-goals

- No remote raid automation, no bot play, no interaction with a live game session.
- No login to any Pokémon GO / Niantic account, ever, in any phase.
- Any scan is **screenshot-in → OCR-out**. Never reads game memory, never automates
  taps, never uses an accessibility service to control the game.

Rule of thumb: if a feature would require the app to *act inside* Pokémon GO rather
than *read a screenshot the user handed it*, it is out of scope.

## Decisions (settled 2026-09-02)

| Question | Decision |
|---|---|
| Stack | Vite + React + TypeScript, static build |
| Hosting | Static deploy, phone-friendly (host chosen once Phase 1 works) |
| Layout | Mobile-first — used at the gym on a phone |
| Roster storage | localStorage, multiple named trainer profiles, JSON export/import |
| Roster sharing | All family profiles maintained on one device; no sync backend |
| Boss list | `bosses.json` in repo, hand-edited every rotation, redeploy |
| Engine fidelity | Time-step simulation, no dodging (Pokebattler's default assumption) |
| Toolchain | Node via Homebrew, git repo local, deploy deferred |

## Correction to the original brief

The brief claimed raid boss HP scales with lobby size (diminishing). **It does not.**
Boss HP and boss level/CPM are fixed per tier. Group size multiplies the *attackers'*
combined DPS only. This makes solo/duo/trio estimates a straightforward DPS division
rather than a scaling table that needs sourcing. Durability still matters indirectly:
faints cost time (swap delay, and relobby time if the whole party wipes), which the
time-step sim accounts for. Exact per-tier HP / CPM / timer values to be verified
against PokeMiners + community sources during Phase 1, not assumed.

## Data sources

- **Species / moves / types / CPM**: PokeMiners `game_masters` (`latest.json`).
  Vendored at a pinned commit, re-pulled manually on game updates. The 19MB
  dump is reduced to a 108KB packed bundle by `npm run build:gm` — move names
  are interned into one id table and every record is a positional tuple, which
  is what takes it from 460KB to 108KB (34KB gzipped). `unpack` in
  `src/engine/gamemaster.ts` is the exact inverse and runs once at load.
- **Current raid bosses**: Leek Duck's boss page, transcribed by hand into
  `src/data/bosses.json` (speciesId, tier, boss moveset).
- **Reference implementation**: PvPoke (open source) for damage formula, stat
  calculation, and Game Master parsing. Study, don't copy wholesale.
- **Validation**: Pokebattler DPS/TDO/time-to-win numbers for a handful of known
  matchups, frozen as test fixtures. **Still needed — see Outstanding inputs.**

## What turned out to be in the Game Master

More than the brief assumed. All of these are read from the dump rather than
hardcoded, so they cannot drift:

- STAB (1.2), weather bonus (1.2), shadow attack/defense (1.2 / 0.8333)
- Friendship attack multipliers, all six levels
- Mega lobby boost (1.3 same type, 1.1 different)
- Weather condition → boosted types
- Swap duration, dodge window and reduction, boss energy regen per HP lost
- **Elite-TM-only moves, flagged per species** (`eliteQuickMove` /
  `eliteCinematicMove`). Phase 3 assumed this needed a hand-maintained legacy
  list; mostly it does not. A small supplement may still be needed for
  event-exclusive moves that are not Elite-TM-gated.

What is *not* in the dump: the raid tier table (boss HP, boss CPM, timer).
That lives in `src/engine/raidTiers.ts` and is **currently an unverified stub**.

## Raid tier constants — sourced

`src/data/raidTiers.json`, refreshed by `npm run fetch:tiers`, comes from
Pokebattler's public `fight.pokebattler.com/raids` endpoint, which exposes
`hp`, `cpm` and `combatTimeMs` per tier. Note `bossCpm` is not a player-level
CPM (tier 4 uses 1.0, Elite 0.985); the tier's displayed level is informational
only and must never be fed to `cpm()`.

## Validation status — READ BEFORE TRUSTING OUTPUT

| Layer | Validated against | Status |
|---|---|---|
| Base stats, CPM, CP | Published max-CP values; PvPoke half-level table | Solid |
| Type chart, move data | Game Master, with index-order assertions | Solid |
| Damage formula | Hand calculation on known matchups | Solid |
| Raid tier constants | Pokebattler `/raids` endpoint | Sourced, not independently confirmed |
| Time-step simulation | Pokebattler, 18 matchups / 3 bosses | Cross-validated, ~11% optimistic |

Against Pokebattler's `estimator` (trainers needed) across 18 attacker/boss
matchups, this engine's mean ratio is **0.89** with a range of 0.67-0.95 — we
consistently say *fewer* trainers are needed than they do.

That direction is expected: this engine assumes zero input delay between
moves, so its DPS is a clean ceiling no real player reaches. **It has not been
tuned to close the gap** — inventing a delay constant to match someone else's
simulator would make the agreement meaningless rather than meaningful. The
bounds in `pokebattler.test.ts` pin the measured behaviour so a future
regression moves them.

Practical reading: **treat the tool as ~10% optimistic.** If it says a trio
just barely wins, that is a coin flip, not a plan. A comfortable margin is
real. The frailest attackers diverge most (Blacephalon vs Regice sits at 0.67
with 14 faints) because our flat 10s relobby is cruder than their per-faint
modelling.

Fixtures live in `src/engine/__tests__/fixtures/pokebattler.json`, pulled from
`fight.pokebattler.com/raids/defenders/{boss}/...`. The per-counter data is
nested under `attackers[0].randomMove.defenders[]` — confusingly, "defenders"
there means the attackers. Free, no account needed, but only for bosses
currently in rotation.

### Known simplifications (all bias toward underestimating the player)

- No dodging; every boss hit lands in full.
- Boss acts on a fixed cycle, not the client's randomised timing.
- Both sides fire charged moves the instant energy allows.
- Group size = N identical copies of one party's damage curve.
- No input delay between moves, so DPS is a clean ceiling. An earlier 500ms
  default was removed: as a flat per-move cost it halved the output of 1000ms
  fast moves, which is not a realistic penalty.

## Phase 1 UI — built

Three tabs, mobile-first: **Boss** (current rotation + weather/friendship),
**Roster** (trainer profiles, search-based species picker, per-Pokémon level /
IVs / moves / shadow / mega), **Results** (solo/duo/trio verdict + ranked
attackers).

- `src/data/bosses.json` is generated by `npm run fetch:bosses` from
  Pokebattler's rotation feed, which is machine-readable — better than hand
  transcribing Leek Duck. Hand-edit the file afterwards if it is ever wrong.
- Rosters live in localStorage under one key, with JSON export/import.
- New roster entries default to the species' best **non-elite** moveset against
  a neutral target, via `src/engine/moveset.ts`. Deliberately not the best
  moveset for the selected boss (the roster is boss-independent) and never an
  Elite-TM-only move (the user probably does not have it). The Results tab says
  so, because it can swing DPS by half.

## Outstanding inputs

None blocking. The fixture set only covers tier 5, because that is what was in
rotation when it was collected — worth extending to a tier 1 and a tier 3 boss
at some point, since those use different `bossCpm` values that nothing
currently exercises against an external reference.

## Phases

Ship Phase 1 completely before starting Phase 2.

### Phase 1 — Raid calculator (MVP), ~1.5–2 weeks

Data model: `Species`, `Move`, `RaidBoss`, `RosterEntry`, `TrainerProfile`.

Engine:
- `stat = (base + IV) × CPM(level)`
- `damage = floor(0.5 × atk/def × power × STAB × effectiveness × weather × modifiers) + 1`
  — constants verified against known Pokebattler outputs.
- Time-step loop: real move durations and damage windows, fast-move energy accrual,
  charged move at threshold, boss HP down / attacker HP down, faint + swap.
- Modifiers in scope for v1: STAB, type effectiveness, weather, shadow, mega, friendship.
- Win condition: boss HP hits 0 before the tier timer. Output ranked attackers by
  DPS/TDO plus estimated time-to-win for 1 / 2 / 3 trainers.

UI: pick boss → pick up to 6 of your Pokémon (manual entry) → ranked attackers +
solo/duo/trio verdict.

### Phase 2 — Fast scan — BUILT

Upload screenshots → OCR → fuzzy-match name → extract CP/HP →
**review-and-correct screen** → roster. No overlay, no accessibility service,
no login, works on any platform.

- **Tesseract.js**, dynamically imported so it costs nothing until the Scan
  tab is opened. The main bundle grew 3.7KB; the WASM and language data load
  from CDN on first use, so the first scan needs a network connection.
- Images narrower than 1000px are upscaled first — Tesseract degrades badly
  below that, and share-sheet screenshots often land there.
- **Level is estimated from CP** assuming 15/15/15 IVs (`estimateLevel`).
  Exact IV solving is skipped per the brief. The assumption errs in the safe
  direction: a real 10/10/10 shows a lower CP than a hundo, so it maps to a
  lower estimated level and *understates* damage.
- **Name matching folds OCR glyph confusions** (RN/M, 0/O, 1/I, VV/W) on both
  the query and the species list, so the corruption is symmetric and matches
  still land. Digits are recovered separately inside CP/HP fields, where
  "CP 3O56" is common.
- Nothing is saved without review. Rows show why they might be wrong:
  uncertain name match, a CP the species cannot reach, the assumed level.

**Tested with synthetic screenshots only.** The pipeline is verified end to end
— a generated image of "CP 3056 / Machamp / HP 175/175" reads back as MACHAMP,
CP 3056, level 40 — but real Pokémon GO screenshots have stylised fonts over
gradients and photos, and OCR will do measurably worse on them. Accuracy on
real captures is unmeasured. If it disappoints, the next lever is image
preprocessing (greyscale, contrast, cropping to the CP and name regions), which
should be tuned against real captures rather than guessed at.

### Phase 3 — Move recommendations, ~3–5 days

Reuse the Phase 1 engine over every fast+charged combo a species can learn. Requires
a hand-maintained "currently teachable" list so legacy moves are never recommended.
Rank by **DPS/TDO improvement per Elite TM spent** — Elite TMs are the scarce
resource, so that ratio is the number that drives the decision, not raw gap.
