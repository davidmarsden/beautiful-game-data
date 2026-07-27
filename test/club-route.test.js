import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Pink Final club pages publish and resolve stable TBG club routes', async () => {
  const route = await readFile(new URL('../public/clubs/club-route.js', import.meta.url), 'utf8');
  const index = await readFile(new URL('../public/clubs/index.html', import.meta.url), 'utf8');
  const build = await readFile(new URL('../scripts/build-scouting-site.js', import.meta.url), 'utf8');
  assert.match(route, /\^tbg-club-\(\\d\{1,3\}\)\$/);
  assert.match(route, /Number\(club\.universe_slot\) === slot/);
  assert.match(route, /state\.selectedClubId = club\.club_id/);
  assert.match(index, /club-route\.js/);
  assert.match(build, /public\/clubs\/club-route\.js/);
});
