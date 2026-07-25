#!/usr/bin/env node
/**
 * Upload a packaged extension to the Chrome Web Store and publish it.
 *
 *   node scripts/publish-webstore.mjs <path-to-zip>
 *
 * Required environment:
 *   CWS_CLIENT_ID       OAuth client id
 *   CWS_CLIENT_SECRET   OAuth client secret
 *   CWS_REFRESH_TOKEN   OAuth refresh token
 *
 * Optional:
 *   CWS_EXTENSION_ID    defaults to the published item below
 *   CWS_PUBLISH_TARGET  "default" (public, the default) or "trustedTesters"
 *   CWS_DRY_RUN         "true" to upload but stop short of publishing
 *
 * Publishing submits the package for Google's review and, once approved, pushes
 * it to every existing user. There is no undo other than publishing again.
 *
 * Setup that cannot be automated, and one trap:
 *   - The listing metadata (description, screenshots, category, privacy answers)
 *     must already exist in the console. This API uploads and publishes packages
 *     only; it cannot create or edit a listing.
 *   - If the OAuth consent screen is left in "Testing" mode, Google expires
 *     refresh tokens after 7 days and this job starts failing a week after it was
 *     set up. Set the consent screen to "In production" (or Internal).
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

// Extension ids are public, so this is a default rather than a secret.
const EXTENSION_ID = process.env.CWS_EXTENSION_ID || 'kkeldliphfpnofpdfkgdaoamnkjgiogc';
const PUBLISH_TARGET = process.env.CWS_PUBLISH_TARGET || 'default';
const DRY_RUN = process.env.CWS_DRY_RUN === 'true';

const API = 'https://www.googleapis.com/chromewebstore/v1.1';
const UPLOAD_API = 'https://www.googleapis.com/upload/chromewebstore/v1.1';

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('Usage: node scripts/publish-webstore.mjs <path-to-zip>');
  process.exit(1);
}

const missing = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN'].filter(
  (name) => !process.env[name]
);
if (missing.length > 0) {
  console.error(
    `Cannot publish: missing ${missing.join(', ')}.\n\n` +
      `Set these as repository secrets. Generating them is a one-time manual step:\n` +
      `  1. Create a Google Cloud project and enable the Chrome Web Store API.\n` +
      `  2. Create an OAuth client (type: Desktop app) for the client id and secret.\n` +
      `  3. Set the OAuth consent screen to "In production", NOT "Testing" —\n` +
      `     testing-mode refresh tokens expire after 7 days.\n` +
      `  4. Complete the OAuth flow once to obtain a refresh token.`
  );
  process.exit(1);
}

/** Fail loudly with the response body — the store's errors are only useful in full. */
async function ensureOk(response, what) {
  if (response.ok) return response;
  const body = await response.text();
  throw new Error(`${what} failed: HTTP ${response.status}\n${body}`);
}

async function accessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CWS_CLIENT_ID,
      client_secret: process.env.CWS_CLIENT_SECRET,
      refresh_token: process.env.CWS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    // The overwhelmingly common cause, so name it rather than making them guess.
    throw new Error(
      `Could not exchange the refresh token: HTTP ${response.status}\n${body}\n\n` +
        `If this says "invalid_grant", the refresh token has been revoked or expired. ` +
        `Refresh tokens expire after 7 days while the OAuth consent screen is in ` +
        `"Testing" mode — set it to "In production" and mint a new token.`
    );
  }

  const { access_token: token } = await response.json();
  if (!token) throw new Error('Token endpoint returned no access_token.');
  return token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' };
}

async function itemState(token) {
  const response = await fetch(`${API}/items/${EXTENSION_ID}?projection=DRAFT`, {
    headers: authHeaders(token),
  });
  await ensureOk(response, 'Fetching item state');
  return response.json();
}

async function upload(token, zip) {
  console.log(`Uploading ${basename(zipPath)} (${(zip.length / 1024 / 1024).toFixed(1)} MB)…`);

  const response = await fetch(`${UPLOAD_API}/items/${EXTENSION_ID}?uploadType=media`, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/zip' },
    body: zip,
  });
  await ensureOk(response, 'Upload');
  let result = await response.json();

  // Large packages can come back still processing; publishing before the upload
  // settles would publish the previous version.
  const deadline = Date.now() + 5 * 60_000;
  while (result.uploadState === 'IN_PROGRESS' && Date.now() < deadline) {
    console.log('Upload still processing, waiting…');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    result = await itemState(token);
  }

  if (result.uploadState !== 'SUCCESS') {
    const details = (result.itemError ?? [])
      .map((e) => `  - ${e.error_code}: ${e.error_detail}`)
      .join('\n');
    throw new Error(
      `Upload did not succeed (uploadState=${result.uploadState}).\n${details || JSON.stringify(result)}`
    );
  }

  console.log('Upload succeeded.');
  return result;
}

async function publish(token) {
  console.log(`Publishing to "${PUBLISH_TARGET}"…`);

  const response = await fetch(
    `${API}/items/${EXTENSION_ID}/publish?publishTarget=${encodeURIComponent(PUBLISH_TARGET)}`,
    { method: 'POST', headers: { ...authHeaders(token), 'Content-Length': '0' } }
  );
  await ensureOk(response, 'Publish');
  const result = await response.json();

  const statuses = result.status ?? [];
  const details = result.statusDetail ?? [];
  console.log(`Publish status: ${statuses.join(', ') || '(none reported)'}`);
  for (const detail of details) console.log(`  ${detail}`);

  // OK and ITEM_PENDING_REVIEW are both success — the latter simply means the
  // store has queued it for review, which is the normal path for a public publish.
  const acceptable = new Set(['OK', 'ITEM_PENDING_REVIEW', 'PUBLISHED_WITH_FRICTION_WARNING']);
  const bad = statuses.filter((s) => !acceptable.has(s));
  if (bad.length > 0) {
    throw new Error(`Publish reported: ${bad.join(', ')}\n${details.join('\n')}`);
  }

  return result;
}

const zip = await readFile(zipPath);
const token = await accessToken();

await upload(token, zip);

if (DRY_RUN) {
  console.log('CWS_DRY_RUN=true — uploaded as a draft, not published.');
  process.exit(0);
}

const result = await publish(token);

const summary = [
  `Uploaded and published \`${basename(zipPath)}\` to the Chrome Web Store.`,
  `Target: \`${PUBLISH_TARGET}\` · Item: \`${EXTENSION_ID}\``,
  `Status: ${(result.status ?? []).join(', ')}`,
  '',
  'Google reviews the submission before it reaches users; this can take hours to days.',
].join('\n');

console.log(`\n${summary}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
