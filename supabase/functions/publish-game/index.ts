// publish-game: loads the game-data pack (the same one the app ships) into the database's `game` schema
// (supabase/migrations/*_game_data.sql), so Claude looks game facts up there. Called only by this
// repository's publish workflow on main (tools/upload-game.py), which proves who it is with a GitHub
// Actions OIDC token: no stored secret. Rows go into the slot reads are not using; reads switch only once
// game_finish has counted every row. Never deletes.
// Deployed with verify_jwt off: the caller has a GitHub token, not a Supabase one; checked below.
//   POST {action: 'status'}                         -> {pack: <loaded pack hash or null>}
//   POST {action: 'load', pack, table, rows: [...]} -> {rows: n}
//   POST {action: 'finish', pack, meta}             -> {pack, counts}
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS = createRemoteJWKSet(new URL(ISSUER + '/.well-known/jwks'));
const AUDIENCE = 'claude-companion-publish';
const REPO = 'saikyr/claude-companion', OWNER_ID = '93225761';
const TABLES = new Set(['items', 'drops', 'quests', 'npcs', 'vendors', 'rules', 'recipes']);

const out = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return out(405, { error: 'POST only' });
  let claims: Record<string, unknown>;
  try {
    const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    claims = (await jwtVerify(tok, JWKS, { issuer: ISSUER, audience: AUDIENCE })).payload as Record<string, unknown>;
  } catch (_e) {
    return out(401, { error: 'needs a GitHub Actions OIDC token' });
  }
  if (claims.repository !== REPO || String(claims.repository_owner_id) !== OWNER_ID || claims.ref !== 'refs/heads/main' ||
      !String(claims.workflow_ref || '').startsWith(REPO + '/.github/workflows/publish.yml@')) {
    return out(403, { error: 'not the publish workflow on main' });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_e) { return out(400, { error: 'body is not JSON' }); }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const pack = String(body.pack || '');
  if (body.action === 'status') {
    const { data, error } = await sb.rpc('game_pack');
    return error ? out(500, { error: error.message }) : out(200, { pack: data });
  }
  if (!/^[0-9a-f]{16}$/.test(pack)) return out(400, { error: 'pack must be a 16-hex hash' });
  if (body.action === 'load') {
    if (!TABLES.has(String(body.table)) || !Array.isArray(body.rows)) return out(400, { error: 'table and rows needed' });
    const { data, error } = await sb.rpc('game_load', { p_pack: pack, p_table: body.table, p_rows: body.rows });
    return error ? out(500, { error: error.message }) : out(200, { rows: data });
  }
  if (body.action === 'finish') {
    const { data, error } = await sb.rpc('game_finish', { p_pack: pack, p_meta: body.meta });
    return error ? out(500, { error: error.message }) : out(200, data);
  }
  return out(400, { error: 'action: status, load or finish' });
});
