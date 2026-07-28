import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Pink Final club pages resolve both legacy world and Transfermarkt identities', async () => {
  const route = await readFile(new URL('../public/clubs/club-route.js', import.meta.url), 'utf8');
  const index = await readFile(new URL('../public/clubs/index.html', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-scouting-site.js', import.meta.url), 'utf8');
  assert.match(route, /tbgRouteIdentity/);
  assert.match(route, /\^0\\d\{2\}\$/);
  assert.match(route, /Number\(club\.universe_slot\) === universeSlot/);
  assert.match(route, /String\(club\.transfermarkt_club_id \|\| ''\) === transfermarktId/);
  assert.match(route, /state\.selectedClubId = club\.club_id/);
  assert.match(index, /club-route\.js/);
  assert.match(build, /public\/clubs\/club-route\.js/);
});
