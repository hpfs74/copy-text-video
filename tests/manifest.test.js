import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));

describe('manifest', () => {
  it('is manifest v3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('requests only the three permissions it needs and no host permissions', () => {
    expect(new Set(manifest.permissions)).toEqual(
      new Set(['activeTab', 'scripting', 'offscreen'])
    );
    expect(manifest.host_permissions).toBeUndefined();
  });

  it('declares no static content scripts', () => {
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('declares the capture command with a mac-specific binding', () => {
    const command = manifest.commands['capture-frame'];
    expect(command.suggested_key.default).toBe('Ctrl+Shift+S');
    expect(command.suggested_key.mac).toBe('Command+Shift+S');
  });

  it('allows wasm on extension pages', () => {
    expect(manifest.content_security_policy.extension_pages).toContain(
      "'wasm-unsafe-eval'"
    );
  });

  it('requires a chrome version with stable offscreen support', () => {
    expect(Number(manifest.minimum_chrome_version)).toBeGreaterThanOrEqual(116);
  });
});
