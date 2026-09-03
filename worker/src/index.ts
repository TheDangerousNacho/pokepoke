/**
 * Roster sync for one household.
 *
 * Deliberately small. Profiles are stored one KV entry each, and the client
 * decides what to push or pull by comparing timestamps — the Worker has no
 * merge logic and no opinion about conflicts. That keeps the only stateful
 * thing in the project boring, and means a Worker outage degrades the app to
 * exactly what it was before sync existed rather than breaking it.
 */

export interface Env {
  ROSTERS: KVNamespace;
  /** Household passphrase, set with `wrangler secret put SYNC_SECRET`. */
  SYNC_SECRET: string;
  /** Origin allowed to call this, e.g. https://user.github.io */
  ALLOWED_ORIGIN?: string;
}

/** A profile is ~60KB; this is generous while still refusing junk. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const KEY_PREFIX = 'profile:';

/**
 * Timing-safe string comparison.
 *
 * A plain `===` on a secret leaks its length and prefix through response
 * timing. The window is small over the internet, but the fix is three lines.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  // Echo the request origin only when it is the configured one; a wildcard
  // would let any site drive this with a stolen passphrase.
  const allowed = env.ALLOWED_ORIGIN;
  const value = allowed && origin === allowed ? origin : (allowed ?? '');
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });

function authorised(request: Request, env: Env): boolean {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!env.SYNC_SECRET || !token) return false;
  return safeEqual(token, env.SYNC_SECRET);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env, request.headers.get('Origin'));
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (!authorised(request, env)) {
      return json({ error: 'unauthorised' }, 401, cors);
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'profiles') return json({ error: 'not found' }, 404, cors);
    const id = parts[1];

    // GET /profiles — the index. Timestamps live in KV metadata so listing
    // does not have to read every profile body.
    if (!id && request.method === 'GET') {
      const list = await env.ROSTERS.list<{ updatedAt: string; name: string }>({ prefix: KEY_PREFIX });
      return json({
        profiles: list.keys.map((k) => ({
          id: k.name.slice(KEY_PREFIX.length),
          updatedAt: k.metadata?.updatedAt ?? null,
          name: k.metadata?.name ?? null,
        })),
      }, 200, cors);
    }

    if (!id) return json({ error: 'method not allowed' }, 405, cors);

    if (request.method === 'GET') {
      const body = await env.ROSTERS.get(KEY_PREFIX + id, 'text');
      if (body === null) return json({ error: 'not found' }, 404, cors);
      return new Response(body, { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: 'too large' }, 413, cors);

      let profile: { id?: unknown; updatedAt?: unknown; name?: unknown };
      try {
        profile = JSON.parse(text);
      } catch {
        return json({ error: 'invalid JSON' }, 400, cors);
      }
      if (profile.id !== id) return json({ error: 'id mismatch' }, 400, cors);
      if (typeof profile.updatedAt !== 'string') {
        return json({ error: 'updatedAt required' }, 400, cors);
      }

      await env.ROSTERS.put(KEY_PREFIX + id, text, {
        metadata: {
          updatedAt: profile.updatedAt,
          name: typeof profile.name === 'string' ? profile.name : null,
        },
      });
      return json({ ok: true, id, updatedAt: profile.updatedAt }, 200, cors);
    }

    if (request.method === 'DELETE') {
      await env.ROSTERS.delete(KEY_PREFIX + id);
      return json({ ok: true, id }, 200, cors);
    }

    return json({ error: 'method not allowed' }, 405, cors);
  },
};
