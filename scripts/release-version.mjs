#!/usr/bin/env node
/**
 * Derive the next version from conventional commits since the last release tag.
 *
 *   feat:            -> minor
 *   fix: / perf:     -> patch
 *   ! or BREAKING CHANGE -> major
 *   anything else    -> no release
 *
 * manifest.json is the source of truth for the current version, because that is
 * the number Chrome actually shows users; package.json is kept in step with it.
 *
 * Usage:
 *   node scripts/release-version.mjs           # report only
 *   node scripts/release-version.mjs --apply   # write the new version to both files
 *
 * Writes `bump`, `version` and `previous` to $GITHUB_OUTPUT when running in Actions.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const apply = process.argv.includes('--apply');

function git(args, { quiet = false } = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'],
  }).trim();
}

/** Most recent release tag, or null on a repo that has never released. */
function lastReleaseTag() {
  try {
    // Quiet: "no names found" is the expected answer before the first release,
    // not an error worth printing into the build log.
    return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], { quiet: true });
  } catch {
    return null;
  }
}

/** Commit subjects+bodies since `tag`, or the whole history if there is none. */
function commitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const raw = git(['log', range, '--format=%s%n%b%n<<<COMMIT>>>']);
  return raw
    .split('<<<COMMIT>>>')
    .map((c) => c.trim())
    .filter(Boolean);
}

// A conventional-commit header, capturing the type and the optional `!` that
// marks a breaking change: "feat(scope)!: subject"
const HEADER = /^(\w+)(\([^)]*\))?(!)?:/;

function classify(commits) {
  let bump = null;

  for (const commit of commits) {
    const [header, ...bodyLines] = commit.split('\n');
    const body = bodyLines.join('\n');
    const match = HEADER.exec(header);

    // A merge commit or non-conventional subject contributes nothing on its own,
    // but its body may still carry a BREAKING CHANGE footer from a squashed PR.
    const breaking =
      Boolean(match?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body) || /^BREAKING[ -]CHANGE:/m.test(header);

    if (breaking) return 'major';

    const type = match?.[1];
    if (type === 'feat') bump = 'minor';
    else if ((type === 'fix' || type === 'perf') && bump !== 'minor') bump = 'patch';
  }

  return bump;
}

function nextVersion(current, bump) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function writeJsonVersion(path, version) {
  const source = readFileSync(path, 'utf8');
  // Rewrite the version line in place so the file's formatting survives untouched.
  const updated = source.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  if (updated === source) throw new Error(`could not find a version field to update in ${path}`);
  writeFileSync(path, updated);
}

function emit(outputs) {
  console.log(
    Object.entries(outputs)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  );
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n'
    );
  }
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const current = manifest.version;
const tag = lastReleaseTag();
const commits = commitsSince(tag);
const bump = classify(commits);

console.log(`Last release tag: ${tag ?? '(none)'}`);
console.log(`Commits considered: ${commits.length}`);
console.log(`Current version: ${current}`);

if (!bump) {
  console.log('No feat:, fix:, perf: or breaking commits — nothing to release.');
  emit({ bump: 'none', version: current, previous: current });
  process.exit(0);
}

const version = nextVersion(current, bump);

// Chrome accepts 1-4 dot-separated integers, each 0-65535. Semver prerelease or
// build metadata would be rejected at install time, so guard the shape here
// rather than discovering it in the Web Store.
if (!/^\d+\.\d+\.\d+$/.test(version) || version.split('.').some((n) => Number(n) > 65535)) {
  console.error(`Refusing to release invalid Chrome extension version: ${version}`);
  process.exit(1);
}

console.log(`Bump: ${bump} -> ${version}`);

if (apply) {
  writeJsonVersion('manifest.json', version);
  writeJsonVersion('package.json', version);
  console.log('Wrote version to manifest.json and package.json.');
}

emit({ bump, version, previous: current });
