import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';

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

describe('icons', () => {
  // The Web Store rejects an upload missing the 128px icon, and Chrome refuses to
  // load an extension whose manifest points at a file that isn't there. Both are
  // failures you'd otherwise only discover at publish time.
  const REQUIRED = [16, 32, 48, 128];

  it('declares every size the store and the browser UI need', () => {
    expect(Object.keys(manifest.icons ?? {}).map(Number).sort((a, b) => a - b)).toEqual(REQUIRED);
  });

  it.each(REQUIRED)('has a %ipx icon file on disk at the declared path', (size) => {
    const path = manifest.icons[String(size)];
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);
  });

  it.each(REQUIRED)('the %ipx icon is actually that many pixels square', (size) => {
    // Read the dimensions straight out of the PNG IHDR chunk: width and height
    // are big-endian uint32s at byte offsets 16 and 20. A 32px file declared as
    // 128 would be silently accepted by the manifest but look wrong everywhere.
    const header = readFileSync(manifest.icons[String(size)]).subarray(0, 24);
    expect(header.subarray(1, 4).toString()).toBe('PNG');
    expect(header.readUInt32BE(16)).toBe(size);
    expect(header.readUInt32BE(20)).toBe(size);
  });
});
