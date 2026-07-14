#!/usr/bin/env node
// Verifies Supabase credentials and creates the private evidence bucket.
// Run once after setting SUPABASE_URL / SUPABASE_SERVICE_KEY:
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=... \
//     node scripts/setup-supabase-bucket.mjs
//
// (The backend also auto-creates the bucket on first upload; this is just an
//  explicit check you can run to confirm the credentials are valid.)

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
const bucket = process.env.SUPABASE_DOC_BUCKET || 'project-documents';

if (!url || !key) {
  console.error('✗ Set SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment first.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };

async function main() {
  console.log(`→ Creating private bucket "${bucket}" at ${url} ...`);
  const create = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 52428800 }),
  });
  if (create.ok) {
    console.log('✓ Bucket created (private, 50MB file limit).');
  } else if (create.status === 400 || create.status === 409) {
    console.log('✓ Bucket already exists — nothing to do.');
  } else {
    console.error(`✗ Failed (${create.status}): ${await create.text()}`);
    process.exit(1);
  }

  // Confirm we can read it back.
  const get = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers });
  if (!get.ok) { console.error(`✗ Could not read bucket back (${get.status}).`); process.exit(1); }
  const info = await get.json();
  console.log(`✓ Verified: "${info.name}" (public=${info.public}). Storage is ready.`);
}

main().catch((e) => { console.error('✗', e.message); process.exit(1); });
