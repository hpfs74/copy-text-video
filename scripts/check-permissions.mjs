#!/usr/bin/env node
/**
 * Extension permission guard.
 *
 * This extension's core privacy claim is that it can only ever see the tab you
 * explicitly invoke it on, and only at the moment you press the shortcut. That
 * rests on three things staying true: the permission set never grows, no host
 * permissions are ever added, and no static content script is ever declared.
 *
 * Any of those can be widened by a one-line manifest edit that looks harmless
 * in review, so this runs as its own named CI gate rather than living only in
 * the unit tests.
 */
import { readFileSync } from 'node:fs';

const ALLOWED_PERMISSIONS = ['activeTab', 'scripting', 'offscreen'];

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const failures = [];

const declared = manifest.permissions ?? [];
const unexpected = declared.filter((p) => !ALLOWED_PERMISSIONS.includes(p));
const missing = ALLOWED_PERMISSIONS.filter((p) => !declared.includes(p));

if (unexpected.length > 0) {
  failures.push(
    `permissions gained: ${unexpected.join(', ')}\n` +
      `  Only ${ALLOWED_PERMISSIONS.join(', ')} are allowed. Adding a permission ` +
      `widens what the extension can reach without the user's knowledge.`
  );
}

if (missing.length > 0) {
  failures.push(
    `permissions missing: ${missing.join(', ')}\n` +
      `  The extension cannot function without these; removing one is likely a mistake.`
  );
}

if (manifest.host_permissions) {
  failures.push(
    `host_permissions declared: ${JSON.stringify(manifest.host_permissions)}\n` +
      `  Host permissions grant standing access to sites without user action. ` +
      `This extension relies on activeTab, granted per-invocation by the keyboard command.`
  );
}

if (manifest.optional_host_permissions) {
  failures.push(
    `optional_host_permissions declared: ${JSON.stringify(manifest.optional_host_permissions)}\n` +
      `  Not used by this extension; activeTab covers the only access it needs.`
  );
}

if (manifest.content_scripts) {
  failures.push(
    `content_scripts declared statically\n` +
      `  A static content script runs on every matching page load. This extension ` +
      `injects on demand from the service worker instead, so it runs nowhere until invoked.`
  );
}

const csp = manifest.content_security_policy?.extension_pages ?? '';
if (!csp.includes("'wasm-unsafe-eval'")) {
  failures.push(
    `extension_pages CSP no longer allows 'wasm-unsafe-eval'\n` +
      `  The offscreen document needs it to instantiate the Tesseract WASM module.`
  );
}
if (csp.includes('unsafe-eval') && !csp.includes("'wasm-unsafe-eval'")) {
  failures.push(`extension_pages CSP allows full unsafe-eval; only wasm-unsafe-eval is permitted.`);
}

if (failures.length > 0) {
  console.error('Extension permission guard FAILED:\n');
  for (const failure of failures) console.error(`  - ${failure}\n`);
  process.exit(1);
}

console.log(
  `Extension permission guard passed: ${declared.join(', ')}, ` +
    `no host permissions, no static content scripts.`
);
