import { describe, expect, it, beforeEach } from 'vitest';
import handler, { type Env } from '../src/index';

/** Minimal in-memory stand-in for KV, including the metadata that the index uses. */
function fakeKv() {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, options?: { metadata?: unknown }) {
      store.set(key, { value, metadata: options?.metadata ?? null });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix: string }) {
      return {
        keys: [...store.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([name, v]) => ({ name, metadata: v.metadata })),
      };
    },
  };
}

const SECRET = 'correct-horse-battery-staple';
const ORIGIN = 'https://example.github.io';

let env: Env;
beforeEach(() => {
  env = { ROSTERS: fakeKv() as never, SYNC_SECRET: SECRET, ALLOWED_ORIGIN: ORIGIN };
});

const req = (path: string, init: RequestInit & { secret?: string | null } = {}) => {
  const { secret = SECRET, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (secret !== null) headers.set('Authorization', `Bearer ${secret}`);
  headers.set('Origin', ORIGIN);
  return new Request(`https://sync.example.com${path}`, { ...rest, headers });
};

const profile = (id: string, updatedAt: string, name = id) => ({
  id, name, updatedAt, roster: [{ id: 'm1', speciesId: 'MACHAMP' }], parties: [],
});

describe('auth', () => {
  it('refuses a request with no credentials', async () => {
    const res = await handler.fetch(req('/profiles', { secret: null }), env);
    expect(res.status).toBe(401);
  });

  it('refuses the wrong passphrase', async () => {
    const res = await handler.fetch(req('/profiles', { secret: 'wrong' }), env);
    expect(res.status).toBe(401);
  });

  it('refuses a passphrase of the right length but wrong content', async () => {
    const res = await handler.fetch(req('/profiles', { secret: 'x'.repeat(SECRET.length) }), env);
    expect(res.status).toBe(401);
  });

  it('refuses everything when the Worker has no secret configured', async () => {
    const res = await handler.fetch(req('/profiles'), { ...env, SYNC_SECRET: '' });
    expect(res.status).toBe(401);
  });

  it('accepts the right passphrase', async () => {
    const res = await handler.fetch(req('/profiles'), env);
    expect(res.status).toBe(200);
  });
});

describe('CORS', () => {
  it('answers preflight without requiring auth', async () => {
    // The browser sends OPTIONS without the Authorization header, so demanding
    // auth here would make every real request fail.
    const res = await handler.fetch(req('/profiles', { method: 'OPTIONS', secret: null }), env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('does not hand out a wildcard origin', async () => {
    const res = await handler.fetch(req('/profiles'), env);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
  });

  it('refuses to echo an origin that is not the configured one', async () => {
    const headers = new Headers({ Authorization: `Bearer ${SECRET}`, Origin: 'https://evil.example' });
    const res = await handler.fetch(
      new Request('https://sync.example.com/profiles', { headers }),
      env,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});

describe('profiles', () => {
  it('stores and reads one back verbatim', async () => {
    const p = profile('p1', '2026-09-01T00:00:00.000Z');
    const put = await handler.fetch(req('/profiles/p1', { method: 'PUT', body: JSON.stringify(p) }), env);
    expect(put.status).toBe(200);

    const got = await handler.fetch(req('/profiles/p1'), env);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(p);
  });

  it('lists timestamps without reading every body', async () => {
    await handler.fetch(req('/profiles/p1', { method: 'PUT', body: JSON.stringify(profile('p1', '2026-09-01T00:00:00.000Z', 'Will')) }), env);
    await handler.fetch(req('/profiles/p2', { method: 'PUT', body: JSON.stringify(profile('p2', '2026-09-02T00:00:00.000Z', 'Kid A')) }), env);

    const res = await handler.fetch(req('/profiles'), env);
    const body = await res.json() as { profiles: Array<{ id: string; updatedAt: string; name: string }> };
    expect(body.profiles).toHaveLength(2);
    expect(body.profiles.find((p) => p.id === 'p2')?.updatedAt).toBe('2026-09-02T00:00:00.000Z');
    expect(body.profiles.find((p) => p.id === 'p1')?.name).toBe('Will');
  });

  it('overwrites on a later write, since the client decides what wins', async () => {
    await handler.fetch(req('/profiles/p1', { method: 'PUT', body: JSON.stringify(profile('p1', '2026-09-01T00:00:00.000Z', 'old')) }), env);
    await handler.fetch(req('/profiles/p1', { method: 'PUT', body: JSON.stringify(profile('p1', '2026-09-05T00:00:00.000Z', 'new')) }), env);
    const got = await handler.fetch(req('/profiles/p1'), env);
    expect((await got.json() as { name: string }).name).toBe('new');
  });

  it('rejects a body whose id does not match the URL', async () => {
    const res = await handler.fetch(
      req('/profiles/p1', { method: 'PUT', body: JSON.stringify(profile('p2', '2026-09-01T00:00:00.000Z')) }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a profile with no timestamp, which sync could not order', async () => {
    const res = await handler.fetch(
      req('/profiles/p1', { method: 'PUT', body: JSON.stringify({ id: 'p1', name: 'x' }) }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await handler.fetch(req('/profiles/p1', { method: 'PUT', body: 'not json' }), env);
    expect(res.status).toBe(400);
  });

  it('rejects an absurdly large body', async () => {
    const huge = JSON.stringify({ id: 'p1', updatedAt: '2026-09-01T00:00:00.000Z', pad: 'x'.repeat(3 * 1024 * 1024) });
    const res = await handler.fetch(req('/profiles/p1', { method: 'PUT', body: huge }), env);
    expect(res.status).toBe(413);
  });

  it('404s an unknown profile rather than returning empty', async () => {
    const res = await handler.fetch(req('/profiles/nope'), env);
    expect(res.status).toBe(404);
  });

  it('deletes', async () => {
    await handler.fetch(req('/profiles/p1', { method: 'PUT', body: JSON.stringify(profile('p1', '2026-09-01T00:00:00.000Z')) }), env);
    expect((await handler.fetch(req('/profiles/p1', { method: 'DELETE' }), env)).status).toBe(200);
    expect((await handler.fetch(req('/profiles/p1'), env)).status).toBe(404);
  });

  it('404s an unknown route', async () => {
    expect((await handler.fetch(req('/something'), env)).status).toBe(404);
  });
});
