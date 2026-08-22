import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = new URL("../scripts/publish-player-change-release.js", import.meta.url).pathname;

const event = (id, event_type, detected_at, extra = {}) => ({
  event_id: id,
  status: "pending",
  detected_at,
  event_type,
  player_id: `tbg-${id}`,
  transfermarkt_id: id,
  player_name: `Player ${id}`,
  before: null,
  after: null,
  delta: null,
  provenance: { source: "transfermarkt", rating_model_version: "model-v1" },
  publication: { published_at: null, release_id: null },
  ...extra
});

test("older discoveries cannot consume more than one-third of a mixed release", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-release-cap-"));
  const queue = join(dir, "queue.json");
  const releases = join(dir, "releases.json");
  const latest = join(dir, "latest.json");
  const summary = join(dir, "summary.json");
  const entries = [];

  for (let index = 0; index < 40; index += 1) {
    entries.push(event(`n${index}`, "new_player", "2026-08-19T10:00:00.000Z", {
      after: { tbg_rating: 80 + (index % 10), market_value_eur: 1000000 + index }
    }));
  }
  for (let index = 0; index < 40; index += 1) {
    entries.push(event(`r${index}`, "rating_change", "2026-08-20T10:00:00.000Z", {
      before: 80,
      after: 81,
      delta: 1
    }));
  }

  await writeFile(queue, JSON.stringify({ version: "tbg-player-change-queue-v1", entries }), "utf8");
  await execFileAsync(process.execPath, [
    script,
    `--queue=${queue}`,
    `--releases=${releases}`,
    `--latest=${latest}`,
    `--summary=${summary}`,
    "--slot=2026-08-22",
    "--target=30",
    "--max=40",
    "--publishedAt=2026-08-22T09:00:00.000Z"
  ]);

  const history = JSON.parse(await readFile(releases, "utf8"));
  const release = history.releases[0];
  assert.equal(release.event_count, 30);
  assert.equal(release.counts.new_players, 10);
  assert.equal(release.counts.rating_changes, 20);
  assert.ok(release.counts.rating_changes > release.counts.new_players);
});
