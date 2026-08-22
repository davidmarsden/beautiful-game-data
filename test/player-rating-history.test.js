import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = new URL('../scripts/generate-player-rating-history.js', import.meta.url).pathname;

async function writeJson(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }
async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

test('rating history projection is player-indexed and newest-first from immutable releases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tbg-rating-history-'));
  const history = join(dir, 'history.json');
  const database = join(dir, 'database.json');
  const output = join(dir, 'output.json');
  await writeJson(history, { version: 'tbg-player-release-history-v1', releases: [
    { release_id: 'r1', slot: '2026-08-21', published_at: '2026-08-21T09:00:00Z', events: [
      { event_id: 'e1', event_type: 'rating_change', player_id: 'p1', player_name: 'Player One', before: 90, after: 91, delta: 1 },
      { event_id: 'n1', event_type: 'new_player', player_id: 'p2', player_name: 'New Player', after: { tbg_rating: 84 } }
    ]},
    { release_id: 'r2', slot: '2026-08-22', published_at: '2026-08-22T09:00:00Z', events: [
      { event_id: 'e2', event_type: 'rating_change', player_id: 'p1', player_name: 'Player One', before: 91, after: 89, delta: -2 }
    ]}
  ]});
  await writeJson(database, [{ tbg_player_id: 'p1', player_name: 'Player One', tbg_rating: 89 }]);
  await execFileAsync(process.execPath, [script, `--history=${history}`, `--database=${database}`, `--output=${output}`]);
  const result = await readJson(output);
  assert.equal(result.version, 'tbg-player-rating-history-v1');
  assert.equal(result.player_count, 1);
  assert.equal(result.players.p1.current_rating, 89);
  assert.equal(result.players.p1.latest_change.release_id, 'r2');
  assert.deepEqual(result.players.p1.history.map((row) => row.release_id), ['r2', 'r1']);
  assert.equal(result.players.p2, undefined);
});

test('Pink Final build publishes public update archive and rating-history projection', async () => {
  const build = await readFile(new URL('../scripts/build-scouting-site.js', import.meta.url), 'utf8');
  const profile = await readFile(new URL('../public/players/players.js', import.meta.url), 'utf8');
  const archive = await readFile(new URL('../public/player-updates/player-updates.js', import.meta.url), 'utf8');
  const pages = await readFile(new URL('../.github/workflows/publish-scouting-pages.yml', import.meta.url), 'utf8');
  assert.match(build, /player-updates\/">Player Updates/);
  assert.match(build, /player-release-history\.json/);
  assert.match(build, /player-rating-history\.json/);
  assert.match(profile, /Rating History/);
  assert.match(profile, /TBG Ability changes/);
  assert.match(archive, /immutable governed release|governed releases/i);
  assert.match(pages, /generate:player-rating-history/);
});
