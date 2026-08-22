import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value ?? true];
}));

const historyPath = args.history || 'derived/player-changes/player-release-history.json';
const databasePath = args.database || 'derived/player-database/player-database.json';
const outputPath = args.output || 'derived/player-changes/player-rating-history.json';

const historyRaw = JSON.parse(await readFile(historyPath, 'utf8'));
const databaseRaw = JSON.parse(await readFile(databasePath, 'utf8'));
const releases = Array.isArray(historyRaw) ? historyRaw : historyRaw.releases || [];
const players = Array.isArray(databaseRaw) ? databaseRaw : databaseRaw.players || [];
const currentById = new Map(players.map((player) => [String(player.tbg_player_id || player.player_id || ''), player]));
const projection = {};

const orderedReleases = [...releases].sort((a, b) => {
  const time = Date.parse(a.published_at || '') - Date.parse(b.published_at || '');
  if (time) return time;
  return String(a.release_id || '').localeCompare(String(b.release_id || ''));
});

for (const release of orderedReleases) {
  const events = Array.isArray(release.events) ? release.events : [];
  for (const event of events) {
    if (event.event_type !== 'rating_change') continue;
    const playerId = String(event.player_id || '').trim();
    if (!playerId) continue;
    const before = Number(event.before);
    const after = Number(event.after);
    if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
    const change = {
      release_id: release.release_id || event.publication?.release_id || null,
      slot: release.slot || null,
      published_at: release.published_at || event.publication?.published_at || null,
      event_id: event.event_id || null,
      before,
      after,
      delta: Number.isFinite(Number(event.delta)) ? Number(event.delta) : after - before,
      player_name: event.player_name || null,
      transfermarkt_id: event.transfermarkt_id || null,
      provenance: event.provenance || null
    };
    if (!projection[playerId]) projection[playerId] = { player_id: playerId, history: [] };
    projection[playerId].history.push(change);
  }
}

for (const [playerId, record] of Object.entries(projection)) {
  record.history.sort((a, b) => {
    const time = Date.parse(b.published_at || '') - Date.parse(a.published_at || '');
    if (time) return time;
    return String(b.release_id || '').localeCompare(String(a.release_id || ''));
  });
  const current = currentById.get(playerId);
  record.player_name = current?.player_name || current?.display_name || record.history[0]?.player_name || null;
  record.transfermarkt_id = current?.transfermarkt_id || current?.transfermarkt_player_id || record.history[0]?.transfermarkt_id || null;
  record.current_rating = Number.isFinite(Number(current?.tbg_rating)) ? Number(current.tbg_rating) : record.history[0]?.after ?? null;
  record.latest_change = record.history[0] || null;
}

const output = {
  version: 'tbg-player-rating-history-v1',
  generated_at: new Date().toISOString(),
  source: 'derived/player-changes/player-release-history.json',
  player_count: Object.keys(projection).length,
  players: projection
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ player_count: output.player_count, output: outputPath }, null, 2));
