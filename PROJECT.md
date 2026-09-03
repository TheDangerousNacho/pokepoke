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
  Vendored at a pinned commit, re-pulled manually on game updates.
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
| **Time-step simulation** | **Internal invariants only** | **NOT externally validated** |

The simulation reproduces sensible orderings (super-effective attackers rank
above resisted ones, shadows out-damage their twins, deeper benches last
longer) and its absolute DPS numbers are in the right range, but no output has
been checked against an independent simulator. Treat time-to-win figures as
indicative, not authoritative.

Why not Pokebattler: their counters endpoint returns aggregates averaged over
their own attacker pool, using Monte Carlo with randomised boss movesets and a
dodge model this engine deliberately omits. Matching it exactly would mean
reimplementing their strategy model. A fair comparison needs either a
per-attacker endpoint or hand-collected figures from their UI.

### Known simplifications (all bias toward underestimating the player)

- No dodging; every boss hit lands in full.
- Boss acts on a fixed cycle, not the client's randomised timing.
- Both sides fire charged moves the instant energy allows.
- 500ms default reaction delay after each player move.
- Group size = N identical copies of one party's damage curve.

## Outstanding inputs

1. **Pokebattler fixtures** — hand-collected from their UI (boss + attacker +
   moveset + reported DPS/TDO/estimator) to turn the simulation row above from
   "not validated" into a real test.

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

### Phase 2 — Fast scan, ~1–1.5 weeks

Upload a handful of screenshots → OCR → fuzzy-match name against species list →
extract CP/HP → **review-and-correct screen** before saving. No overlay, no
accessibility service, works on any platform. Skip exact IV solving in v1: IV
precision moves DPS by only a few percent, and CP + species seeds a usable roster.

### Phase 3 — Move recommendations, ~3–5 days

Reuse the Phase 1 engine over every fast+charged combo a species can learn. Requires
a hand-maintained "currently teachable" list so legacy moves are never recommended.
Rank by **DPS/TDO improvement per Elite TM spent** — Elite TMs are the scarce
resource, so that ratio is the number that drives the decision, not raw gap.
