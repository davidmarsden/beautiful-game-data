import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pink Final player profiles prefer the governed derived player database', async () => {
  const source = await read('public/players/players.js');
  const derived = source.indexOf('../../derived/player-database/player-database.json');
  const staleFallback = source.indexOf('../scouting/player-database.json');
  assert.ok(derived >= 0, 'governed derived player database path is present');
  assert.ok(staleFallback >= 0, 'legacy deployment fallback remains available');
  assert.ok(derived < staleFallback, 'governed derived database is preferred to legacy fallback');
  assert.match(source, /fetch\(url,\{cache:"no-store"\}\)/);
});

test('Pink Final Pages artifact publishes the governed database at the preferred derived path', async () => {
  const builder = await read('scripts/build-scouting-site.js');
  assert.match(builder, /join\(outputDir, "derived", "player-database", "player-database\.json"\)/);
  assert.match(builder, /copy\("derived\/player-database\/player-database\.json"/);
  assert.match(builder, /join\(outputDir, "scouting", "player-database\.json"\)/);
});
