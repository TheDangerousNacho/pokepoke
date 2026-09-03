# Pokémon GO Raid Planner

A small personal tool that answers two questions about a raid boss:

1. What is the best team I have for this?
2. Can we realistically beat it solo, as a pair, or as a trio?

**[Open the app →](https://thedangerousnacho.github.io/pokepoke/)**

It runs entirely in the browser. There is no account, no server, and no
connection to Pokémon GO — your roster is stored on your own device.

## What it does

- **Boss** — pick from the current raid rotation, set weather and friendship.
- **Roster** — enter your Pokémon once; they are saved on that device. Several
  trainer profiles, with JSON export/import to move them between phones.
- **Scan** — upload screenshots of a Pokémon's detail screen and it reads the
  species, CP and HP off them, with a review step before anything is saved.
- **Results** — ranked attackers, and whether 1, 2 or 3 trainers can win.
- **TMs** — whether a TM would meaningfully improve anything you own, ranked by
  gain per Elite TM, since that is the scarce resource.

## What it deliberately does not do

No login to any Pokémon GO or Niantic account, ever. No automation, no reading
game memory, no accessibility service, no interaction with a running game. The
scan is screenshot-in, text-out — the same category as Calcy IV or Pokebattler.

## Accuracy

The battle simulation agrees with Pokebattler to within about 11% across 18
tested matchups, and is consistently *optimistic* — it assumes no dodging and
no input delay. **Treat a narrow win as a coin flip, not a plan.**

`PROJECT.md` documents the data sources, what was validated against what, and
the known simplifications.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # 178 tests
npm run typecheck
npm run build      # static bundle in dist/
```

Data refresh, needed occasionally rather than routinely:

```bash
npm run build:gm     # re-pull the PokeMiners game master (pinned commit)
npm run fetch:tiers  # raid tier HP / CPM / timers
npm run fetch:bosses # the current boss rotation
npm run make:icons   # regenerate the PWA icons
```

## Credits

Game data from [PokeMiners](https://github.com/PokeMiners/game_masters). Raid
tier constants, the boss rotation, and the validation fixtures come from
[Pokebattler](https://www.pokebattler.com/)'s public API.
