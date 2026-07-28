import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url));

test('Pink Final pins the governed v1.0.1 contract bytes', async () => {
  const manifest = JSON.parse((await read('design-contract/tbg-design-contract.manifest.json')).toString('utf8'));
  const css = await read(manifest.consumer.path);
  const sha = createHash('sha1').update(Buffer.from(`blob ${css.byteLength}\0`)).update(css).digest('hex');
  assert.equal(manifest.version, '1.0.1');
  assert.equal(manifest.governedSource.repository, 'davidmarsden/beautiful-game-manager');
  assert.equal(manifest.governedSource.path, 'public/tbg-design-contract.css');
  assert.equal(sha, 'b8cc54bf27e0b0116e82f518d14398cb6f97dbb3');
  assert.equal(sha, manifest.governedSource.blobSha);
});

test('site build publishes the contract and Pink Final mapping on every page', async () => {
  const build = (await read('scripts/build-scouting-site.js')).toString('utf8');
  assert.match(build, /site\/tbg-design-contract\.css/);
  assert.match(build, /public\/pink-final-theme\.css/);
  assert.match(build, /tbg-design-contract\.css/);
  assert.match(build, /pink-final-theme\.css/);
  assert.match(build, /class="nav tbg-nav"/);
  for (const section of ['scouting', 'clubs', 'players', 'wonderkids', 'rankings', 'transfer-market', 'new-this-week']) {
    assert.ok(build.includes(`"${section}"`));
  }
});

test('contract-only changes trigger and verify Pink Final publishing', async () => {
  const workflow = (await read('.github/workflows/publish-scouting-pages.yml')).toString('utf8');
  assert.match(workflow, /- site\/\*\*/);
  assert.match(workflow, /- design-contract\/\*\*/);
  assert.match(workflow, /- scripts\/verify-design-contract\.js/);
  assert.match(workflow, /run: npm run design-contract:verify/);
});

test('product theme maps legacy Pink Final surfaces onto governed tokens', async () => {
  const theme = (await read('public/pink-final-theme.css')).toString('utf8');
  for (const token of ['--tbg-colour-paper', '--tbg-colour-ink', '--tbg-colour-rule', '--tbg-font-editorial', '--tbg-colour-action']) {
    assert.ok(theme.includes(token), `missing ${token}`);
  }
  assert.match(theme, /\.nav\.tbg-nav/);
  assert.match(theme, /prefers-reduced-motion|tbg-design-contract v1\.0\.1/);
});

test('club squad headers map foreground and background together', async () => {
  const theme = (await read('public/pink-final-theme.css')).toString('utf8');
  assert.match(theme, /\.squad-table thead th,[\s\S]*\.squad-table th/);
  assert.match(theme, /\.squad-table[\s\S]*color: var\(--tbg-colour-cream\)/);
  assert.match(theme, /\.squad-table[\s\S]*background: var\(--tbg-colour-ink\)/);
});

test('consumer keeps editorial overrides separate from immutable contract', async () => {
  const contract = (await read('site/tbg-design-contract.css')).toString('utf8');
  const theme = (await read('public/pink-final-theme.css')).toString('utf8');
  assert.doesNotMatch(contract, /Pink Final product mapping/);
  assert.match(theme, /Pink Final product mapping/);
  assert.doesNotMatch(theme, /world_id|appointment_id|manager_command|save_envelope/);
});
