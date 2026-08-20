import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = new URL("../scripts/publish-player-change-release.js", import.meta.url).pathname;

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runRelease(paths, extra = []) {
  await execFileAsync(process.execPath, [
    script,
    `--queue=${paths.queue}`,
    `--releases=${paths.releases}`,
    `--latest=${paths.latest}`,
    `--summary=${paths.summary}`,
    ...extra
  ]);
}

function event(id, type, detectedAt, extra = {}) {
  return {
    event_id: id,
    status: "pending",
    detected_at: detectedAt,
    event_type: type,
    player_id: `tbg-${id}`,
    transfermarkt_id: id.replace(/\D/g, "") || id,
    player_name: `Player ${id}`,
    before: null,
    after: null,
    delta: null,
    provenance: { source: "transfermarkt", rating_model_version: "model-v1" },
    publication: { published_at: null, release_id: null },
    ...extra
  };
}

test("rolling release publishes eligible events deterministically and spills over", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-player-release-"));
  const paths = Object.fromEntries(["queue", "releases", "latest", "summary"].map((name) => [name, join(dir, `${name}.json`)]));
  await writeJson(paths.queue, {
    version: "tbg-player-change-queue-v1",
    entries: [
      event("e1", "rating_change", "2026-08-20T10:00:00.000Z", { before: 80, after: 81, delta: 1 }),
      event("e2", "rating_change", "2026-08-20T10:00:00.000Z", { before: 88, after: 90, delta: 2 }),
      event("e3", "new_player", "2026-08-20T10:00:00.000Z", { after: { tbg_rating: 86, market_value_eur: 5000000 } }),
      event("e4", "club_change", "2026-08-19T09:00:00.000Z", { before: "Old FC", after: "New FC" }),
      event("e5", "rating_change", "2026-08-21T10:00:00.000Z", { before: 84, after: 85, delta: 1 })
    ]
  });

  await runRelease(paths, ["--slot=2026-08-20", "--target=2", "--max=3", "--publishedAt=2026-08-20T12:00:00.000Z"]);
  const firstQueue = await readJson(paths.queue);
  const firstHistory = await readJson(paths.releases);
  const firstLatest = await readJson(paths.latest);
  assert.equal(firstHistory.releases.length, 1);
  assert.deepEqual(firstHistory.releases[0].event_ids, ["e2", "e3"]);
  assert.equal(firstHistory.releases[0].counts.rating_changes, 1);
  assert.equal(firstHistory.releases[0].counts.new_players, 1);
  assert.equal(firstLatest.ratings_updates.length, 1);
  assert.equal(firstLatest.new_players.length, 1);
  assert.equal(firstLatest.pending_eligible, 2);
  assert.equal(firstQueue.entries.find((row) => row.event_id === "e4").status, "pending");

  const historySerialised = JSON.stringify(firstHistory);
  const queueSerialised = JSON.stringify(firstQueue);
  await runRelease(paths, ["--slot=2026-08-20", "--target=2", "--max=3", "--publishedAt=2026-08-20T13:00:00.000Z"]);
  assert.equal(JSON.stringify(await readJson(paths.releases)), historySerialised);
  assert.equal(JSON.stringify(await readJson(paths.queue)), queueSerialised);
  assert.equal((await readJson(paths.summary)).idempotent_replay, true);

  await runRelease(paths, ["--slot=2026-08-21", "--target=2", "--max=2", "--publishedAt=2026-08-21T12:00:00.000Z"]);
  const secondHistory = await readJson(paths.releases);
  assert.equal(secondHistory.releases.length, 2);
  assert.deepEqual(secondHistory.releases[1].event_ids, ["e1", "e5"]);
  assert.equal((await readJson(paths.latest)).pending_eligible, 0);
});

test("state-only events publish only when explicitly enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-player-release-state-"));
  const paths = Object.fromEntries(["queue", "releases", "latest", "summary"].map((name) => [name, join(dir, `${name}.json`)]));
  await writeJson(paths.queue, {
    version: "tbg-player-change-queue-v1",
    entries: [event("s1", "club_change", "2026-08-20T10:00:00.000Z", { before: "A", after: "B" })]
  });

  await runRelease(paths, ["--slot=2026-08-20", "--publishedAt=2026-08-20T12:00:00.000Z"]);
  assert.equal((await readJson(paths.summary)).published_events, 0);
  assert.equal((await readJson(paths.queue)).entries[0].status, "pending");

  await runRelease(paths, ["--slot=2026-08-21", "--includeStateChanges=true", "--publishedAt=2026-08-21T12:00:00.000Z"]);
  const history = await readJson(paths.releases);
  assert.equal(history.releases.length, 1);
  assert.equal(history.releases[0].counts.other_updates, 1);
  assert.equal((await readJson(paths.queue)).entries[0].status, "published");
});
