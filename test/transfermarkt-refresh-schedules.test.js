import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const knownWorkflow = new URL("../.github/workflows/refresh-known-transfermarkt-players.yml", import.meta.url);
const discoveryWorkflow = new URL("../.github/workflows/refresh-transfermarkt-and-publish.yml", import.meta.url);
const monthlyWideWorkflow = new URL("../.github/workflows/refresh-wide-transfermarkt-monthly.yml", import.meta.url);

test("weekday refresh mixes priority known players with rotating playable-club discovery", async () => {
  const workflow = await readFile(knownWorkflow, "utf8");
  const crons = [...workflow.matchAll(/cron: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(crons, ["15 5 * * 1-5"]);
  assert.match(workflow, /REFRESH_EDITION: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.edition \|\| 'daily' \}\}/);
  assert.match(workflow, /CUSTOM_LIMIT: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.customLimit \|\| '' \}\}/);
  assert.match(workflow, /--limit=300/);
  assert.match(workflow, /--mode="\$REFRESH_EDITION"/);
  assert.match(workflow, /--scope=known/);
  assert.match(workflow, /export-daily-transfermarkt-discovery-scope\.js/);
  assert.match(workflow, /--batchSize=10/);
  assert.match(workflow, /--scope=universe/);
  assert.match(workflow, /--maxItems=500/);
  assert.match(workflow, /restore-zero-market-values\.js/);
  assert.match(workflow, /echo '\[\]' > calibration\/empty-transfermarkt-refresh\.json/);
  assert.match(workflow, /--input=calibration\/empty-transfermarkt-refresh\.json/);
  assert.match(workflow, /daily-transfermarkt-new-players-report\.json/);
});

test("playable-club discovery refresh runs weekly without scheduled wide scraping", async () => {
  const workflow = await readFile(discoveryWorkflow, "utf8");
  const crons = [...workflow.matchAll(/cron: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(crons, ["45 4 * * 0"]);
  assert.match(workflow, /MAX_ITEMS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.maxItems \|\| '10000' \}\}/);
  assert.match(workflow, /INCLUDE_WIDE_COMPETITIONS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.includeWideCompetitions \|\| 'false' \}\}/);
  assert.match(workflow, /--scope=universe/);
  assert.match(workflow, /--scope=wide/);
});

test("wider-competition discovery refresh runs monthly and retrieves the full requested dataset", async () => {
  const workflow = await readFile(monthlyWideWorkflow, "utf8");
  const crons = [...workflow.matchAll(/cron: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(crons, ["45 2 1 * *"]);
  assert.match(workflow, /MAX_ITEMS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.maxItems \|\| '10000' \}\}/);
  assert.match(workflow, /--scope=wide/);
  assert.match(workflow, /--maxItems="\$MAX_ITEMS"/);
  assert.match(workflow, /--datasetLimit="\$MAX_ITEMS"/);
});
