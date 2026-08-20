import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = new URL("../scripts/generate-player-change-queue.js", import.meta.url).pathname;

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function runQueue(paths) {
  await execFileAsync(process.execPath, [
    script,
    `--ledger=${paths.ledger}`,
    `--queue=${paths.queue}`,
    `--batch=${paths.batch}`,
    `--summary=${paths.summary}`,
    `--master=${paths.master}`,
    `--ratingProfiles=${paths.ratings}`
  ]);
}

test("player change queue appends deterministic provenance-rich events exactly once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-change-queue-"));
  const paths = Object.fromEntries(["ledger", "queue", "batch", "summary", "master", "ratings"].map((name) => [name, join(dir, `${name}.json`)]));

  await writeJson(paths.ledger, {
    summary: { generated_at: "2026-08-20T20:30:00.000Z", first_edition: false },
    changes: [
      {
        type: "rating_change",
        player_id: "tbg-tm-001364573",
        player_name: "Victor Hugo Custódio de Melo Moura",
        before: 81,
        after: 82,
        delta: 1,
        current: { tbg_player_id: "tbg-tm-001364573", transfermarkt_id: "1364573", tbg_rating: 82, source: "transfermarkt" }
      },
      {
        type: "new_player",
        player_id: "tbg-tm-00012345",
        player_name: "New Prospect",
        current: { tbg_player_id: "tbg-tm-00012345", transfermarkt_id: "12345", tbg_rating: 76, current_club: "Example FC", market_value_eur: 1200000 }
      }
    ]
  });
  await writeJson(paths.master, [
    { transfermarkt_id: "1364573", display_name: "Huguinho", scraped_at: "2026-08-20T19:50:00.000Z", market_value_determined: "2026-05-26", source: "apify-transfermarkt-global-player-scraper" },
    { transfermarkt_id: "12345", display_name: "New Prospect", scraped_at: "2026-08-20T19:51:00.000Z", source: "apify-transfermarkt-global-player-scraper" }
  ]);
  await writeJson(paths.ratings, [
    {
      tbg_player_id: "tbg-tm-001364573",
      transfermarkt_id: "1364573",
      ability: {
        model_version: "tbg-v3-sticky-ability-fluid-form",
        explanation: { market_value_eur: 300000, age: 19 }
      }
    },
    {
      tbg_player_id: "tbg-tm-00012345",
      transfermarkt_id: "12345",
      ability: {
        model_version: "tbg-v3-sticky-ability-fluid-form",
        explanation: { market_value_eur: 1200000, age: 18 }
      }
    }
  ]);

  await runQueue(paths);
  const first = await readJson(paths.queue);
  assert.equal(first.entries.length, 2);
  assert.equal(first.entries[0].status, "pending");
  assert.match(first.entries[0].event_id, /^pchg_[a-f0-9]{24}$/);
  assert.equal(first.entries[0].provenance.source_scraped_at, "2026-08-20T19:50:00.000Z");
  assert.equal(first.entries[0].provenance.rating_model_version, "tbg-v3-sticky-ability-fluid-form");
  assert.deepEqual(first.entries[0].provenance.rating_inputs, { market_value_eur: 300000, age: 19 });

  const firstSerialised = JSON.stringify(first.entries);
  await runQueue(paths);
  const second = await readJson(paths.queue);
  const secondBatch = await readJson(paths.batch);
  assert.equal(second.entries.length, 2);
  assert.equal(JSON.stringify(second.entries), firstSerialised);
  assert.equal(secondBatch.appended_events, 0);
  assert.equal(secondBatch.duplicate_events_skipped, 2);
});

test("removed player with no surviving rating profile preserves unknown model provenance as null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-change-queue-removed-"));
  const paths = Object.fromEntries(["ledger", "queue", "batch", "summary", "master", "ratings"].map((name) => [name, join(dir, `${name}.json`)]));
  await writeJson(paths.ledger, {
    summary: { generated_at: "2026-08-20T21:00:00.000Z", first_edition: false },
    changes: [{
      type: "removed_player",
      player_id: "tbg-tm-00099999",
      player_name: "Departed Player",
      previous: { tbg_player_id: "tbg-tm-00099999", transfermarkt_id: "99999", tbg_rating: 84, current_club: "Old Club" }
    }]
  });
  await writeJson(paths.master, []);
  await writeJson(paths.ratings, []);

  await runQueue(paths);
  const queue = await readJson(paths.queue);
  assert.equal(queue.entries.length, 1);
  assert.equal(queue.entries[0].event_type, "removed_player");
  assert.equal(queue.entries[0].provenance.rating_model_version, null);
});

test("first published edition establishes a baseline without flooding the queue", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tbg-change-queue-baseline-"));
  const paths = Object.fromEntries(["ledger", "queue", "batch", "summary", "master", "ratings"].map((name) => [name, join(dir, `${name}.json`)]));
  await writeJson(paths.ledger, {
    summary: { generated_at: "2026-08-20T20:30:00.000Z", first_edition: true },
    changes: [{ type: "new_player", player_id: "tbg-tm-00000001", player_name: "Baseline Player", current: { transfermarkt_id: "1", tbg_rating: 80 } }]
  });
  await writeJson(paths.master, []);
  await writeJson(paths.ratings, []);

  await runQueue(paths);
  const queue = await readJson(paths.queue);
  const summary = await readJson(paths.summary);
  assert.equal(queue.entries.length, 0);
  assert.equal(summary.first_edition_baseline_only, true);
  assert.equal(summary.appended_events, 0);
});
