# Sync Worker

Optional cross-device roster sync. The app works fully without it — this only
saves passing an export file between phones.

One KV entry per trainer profile. The Worker has no merge logic: the client
compares `updatedAt` per profile and decides what to push or pull. That keeps
the only stateful piece of the project boring, and means an outage degrades
the app to exactly what it was before sync existed.

## Deploying

You need a free Cloudflare account. From this directory:

```bash
npx wrangler login                      # opens a browser
npx wrangler kv namespace create ROSTERS
```

Put the returned id into `wrangler.toml` under `[[kv_namespaces]]`, set
`ALLOWED_ORIGIN` to where the app is served from, then:

```bash
npx wrangler secret put SYNC_SECRET     # your household passphrase
npx wrangler deploy
```

Wrangler prints the Worker URL. In the app, open Roster → Sync across devices,
paste that URL and the same passphrase, and press Sync now. Repeat on each
phone with the same two values.

## Running it locally

```bash
cp .dev.vars.example .dev.vars          # then edit the values
npx wrangler dev --local --port 8787
```

## About the passphrase

It is a lock on a public endpoint, not real security. It stops a stray visitor
reading or wiping your rosters; it is not a personal password and everyone in
the household uses the same one. Compared in constant time, and the Worker
refuses every request if it is unset.

## API

    GET    /profiles       index: id, updatedAt, name (from KV metadata)
    GET    /profiles/:id   one profile
    PUT    /profiles/:id   store one profile (body id must match the URL)
    DELETE /profiles/:id

All require `Authorization: Bearer <passphrase>`. `OPTIONS` is exempt, because
browsers send preflight without credentials.
