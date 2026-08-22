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

function releasePaths(dir) {
  return Object.fromEntries(["queue", "releases", "latest", "summary"].map((name) => [name, join(dir, `${name}.json`)]));
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

test("rolling release mixes new players into a busy ratings batch and spills over deterministically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-player-release-"));
  const paths = releasePaths(dir);
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
  const firstSummary = await readJson(paths.summary);
  assert.equal(firstHistory.releases.length, 1);
  assert.deepEqual(firstHistory.releases[0].event_ids, ["e2", "e3"]);
  assert.equal(firstHistory.releases[0].counts.rating_changes, 1);
  assert.equal(firstHistory.releases[0].counts.new_players, 1);
  assert.equal(firstLatest.ratings_updates.length, 1);
  assert.equal(firstLatest.new_players.length, 1);
  assert.equal(firstLatest.pending_eligible, 2);
  assert.deepEqual(firstLatest.pending, { total: 2, rating_changes: 2, new_players: 0, other_updates: 0 });
  assert.equal(firstSummary.pending_rating_changes, 2);
  assert.equal(firstSummary.pending_new_players, 0);
  assert.equal(firstQueue.entries.find((row) => row.event_id === "e4").status, "pending");

  const historySerialised = JSON.stringify(firstHistory);
  const queueSerialised = JSON.stringify(firstQueue);
  await runRelease(paths, ["--slot=2026-08-20", "--target=2", "--max=3", "--publishedAt=2026-08-20T13:00:00.000Z"]);
  assert.equal(JSON.stringify(await readJson(paths.releases)), historySerialised);
  assert.equal(JSON.stringify(await readJson(paths.queue)), queueSerialised);
  assert.equal((await readJson(paths.summary)).idempotent_replay, true);

  await runRelease(paths, ["--slot=2026-08-21", "--target=2", "--max=2", "--publishedAt=2026-08-21T12:00:00.000Z"]);
  const secondHistory = await readJson(paths.releases);
  const secondReleaseId = secondHistory.releases[1].release_id;
  assert.equal(secondHistory.releases.length, 2);
  assert.deepEqual(secondHistory.releases[1].event_ids, ["e1", "e5"]);
  assert.equal((await readJson(paths.latest)).pending_eligible, 0);
  assert.equal((await readJson(paths.latest)).release.release_id, secondReleaseId);

  await runRelease(paths, ["--slot=2026-08-20", "--target=2", "--max=3", "--publishedAt=2026-08-21T13:00:00.000Z"]);
  assert.equal((await readJson(paths.latest)).release.release_id, secondReleaseId);
  assert.equal((await readJson(paths.summary)).idempotent_replay, true);

  await runRelease(paths, ["--slot=2026-08-22", "--publishedAt=2026-08-22T12:00:00.000Z"]);
  const emptyLatest = await readJson(paths.latest);
  const emptySummary = await readJson(paths.summary);
  assert.equal(emptySummary.published_events, 0);
  assert.equal(emptyLatest.release.release_id, secondReleaseId);
  assert.equal(emptyLatest.pending_eligible, 0);
  assert.deepEqual(emptyLatest.pending, { total: 0, rating_changes: 0, new_players: 0, other_updates: 0 });
});

test("mixed release reserves a bounded share for new players without making them the majority", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-player-release-mixed-"));
  const paths = releasePaths(dir);
  const entries = [];
  for (let index = 0; index < 30; index += 1) {
    entries.push(event(`r${index}`, "rating_change", "2026-08-20T10:00:00.000Z", { before: 80, after: 81, delta: 1 }));
  }
  for (let index = 0; index < 20; index += 1) {
    entries.push(event(`n${index}`, "new_player", "2026-08-20T10:00:00.000Z", { after: { tbg_rating: 80 + index, market_value_eur: 1000000 + index } }));
  }
  await writeJson(paths.queue, { version: "tbg-player-change-queue-v1", entries });

  await runRelease(paths, ["--slot=2026-08-20", "--target=30", "--max=40", "--publishedAt=2026-08-20T12:00:00.000Z"]);
  const release = (await readJson(paths.releases)).releases[0];
  assert.equal(release.event_count, 30);
  assert.equal(release.counts.new_players, 10);
  assert.equal(release.counts.rating_changes, 20);
  assert.match(release.policy.selection, /one-third for new players/);
});

test("publisher fails loudly when the governed queue is missing or malformed", async () => {
  const missingDir = await mkdtemp(join(tmpdir(), "tbg-player-release-missing-"));
  const missingPaths = releasePaths(missingDir);
  await assert.rejects(runRelease(missingPaths, ["--slot=2026-08-20"]), /Governed player-change queue is missing/);

  const malformedDir = await mkdtemp(join(tmpdir(), "tbg-player-release-malformed-"));
  const malformedPaths = releasePaths(malformedDir);
  await writeJson(malformedPaths.queue, []);
  await assert.rejects(runRelease(malformedPaths, ["--slot=2026-08-20"]), /invalid structure/);
});

test("state-only events publish only when explicitly enabled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-player-release-state-"));
  const paths = releasePaths(dir);
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

test("scheduled publication uses explicit safe defaults and does not run a paid refresh", async () => {
  const workflow = await readFile(new URL("../.github/workflows/publish-player-updates.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "15 9 \* \* \*"/);
  assert.match(workflow, /RELEASE_TARGET: \$\{\{ github\.event\.inputs\.target \|\| '30' \}\}/);
  assert.match(workflow, /RELEASE_MAX: \$\{\{ github\.event\.inputs\.max \|\| '40' \}\}/);
  assert.match(workflow, /INCLUDE_STATE_CHANGES: \$\{\{ github\.event\.inputs\.includeStateChanges \|\| 'false' \}\}/);
  assert.match(workflow, /Verify governed queue exists/);
  assert.doesNotMatch(workflow, /APIFY_TOKEN|fetch-apify|Refresh Transfermarkt/i);
});
