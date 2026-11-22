// publish-build: puts a tested build's download zips in the public "releases" bucket.
// Called only by this repository's publish workflow (.github/workflows/publish.yml) on main, which
// proves who it is with a GitHub Actions OIDC token: no stored secret anywhere. The bucket is public
// to read, and only this function (service role) writes it. Never deletes: each publish replaces
// latest/ClaudeCompanion-Windows.zip, latest/ClaudeCompanion-Mac.zip and then latest.json, which the
// installed apps' updaters read (docs/ARCHITECTURE.md, Delivery).
// Deployed with verify_jwt off: the caller has a GitHub token, not a Supabase one; checked below.
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS = createRemoteJWKSet(new URL(ISSUER + '/.well-known/jwks'));
const AUDIENCE = 'claude-companion-publish';
const REPO = 'saikyr/claude-companion', OWNER_ID = '93225761';
const BUCKET = 'releases';
const ZIPS = ['ClaudeCompanion-Windows.zip', 'ClaudeCompanion-Mac.zip'];

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
  // only the publish workflow of this repository, running on main
  if (claims.repository !== REPO || String(claims.repository_owner_id) !== OWNER_ID || claims.ref !== 'refs/heads/main' ||
      !String(claims.workflow_ref || '').startsWith(REPO + '/.github/workflows/publish.yml@')) {
    return out(403, { error: 'not the publish workflow on main' });
  }

  const form = await req.formData();
  const manifestText = String(form.get('manifest') || '');
  let manifest: Record<string, unknown>;
  try { manifest = JSON.parse(manifestText); } catch (_e) { return out(400, { error: 'manifest is not JSON' }); }
  if (!/^[0-9a-f]{40}$/.test(String(manifest.sha || '')) || !manifest.build || !manifest.version) return out(400, { error: 'manifest needs sha, build, version' });
  const files: Record<string, Uint8Array> = {};
  for (const name of ZIPS) {
    const f = form.get(name);
    if (!(f instanceof File) || f.size < 100000 || f.size > 50 * 1024 * 1024) return out(400, { error: 'missing or odd-sized ' + name });
    files[name] = new Uint8Array(await f.arrayBuffer());
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: bucket } = await sb.storage.getBucket(BUCKET);
  if (!bucket) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '50MB' });
    if (error && !/exist/i.test(error.message)) return out(500, { error: 'bucket: ' + error.message });
  }
  const put = (path: string, body: Uint8Array, type: string) =>
    sb.storage.from(BUCKET).upload(path, body, { upsert: true, contentType: type, cacheControl: '60' });
  for (const name of ZIPS) {
    const { error } = await put('latest/' + name, files[name], 'application/zip');
    if (error) return out(500, { error: name + ': ' + error.message });
  }
  // the manifest last: an updater that reads it finds the zips it names already in place
  const { error } = await put('latest.json', new TextEncoder().encode(JSON.stringify(manifest, null, 1)), 'application/json');
  if (error) return out(500, { error: 'latest.json: ' + error.message });
  const base = Deno.env.get('SUPABASE_URL') + '/storage/v1/object/public/' + BUCKET + '/';
  return out(200, { ok: true, base, build: manifest.build, files: [...ZIPS.map((z) => 'latest/' + z), 'latest.json'] });
});
