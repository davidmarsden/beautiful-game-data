import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const knownWorkflow = new URL("../.github/workflows/refresh-known-transfermarkt-players.yml", import.meta.url);
const discoveryWorkflow = new URL("../.github/workflows/refresh-transfermarkt-and-publish.yml", import.meta.url);

test("known-player refresh runs the 500-player daily tier automatically", async () => {
  const workflow = await readFile(knownWorkflow, "utf8");
  const crons = [...workflow.matchAll(/cron: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(crons, ["15 5 * * *"]);
  assert.match(workflow, /REFRESH_EDITION: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.edition \|\| 'daily' \}\}/);
  assert.match(workflow, /CUSTOM_LIMIT: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.customLimit \|\| '' \}\}/);
  assert.match(workflow, /--mode="\$REFRESH_EDITION"/);
  assert.match(workflow, /--scope=known/);
});

test("discovery refresh runs weekly plus an extra transfer-window sweep", async () => {
  const workflow = await readFile(discoveryWorkflow, "utf8");
  const crons = [...workflow.matchAll(/cron: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(crons, ["45 4 * * 0", "45 4 * 1,6,7,8,9 3"]);
  assert.match(workflow, /MAX_ITEMS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.maxItems \|\| '10000' \}\}/);
  assert.match(workflow, /INCLUDE_WIDE_COMPETITIONS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.includeWideCompetitions \|\| 'true' \}\}/);
  assert.match(workflow, /--scope=universe/);
  assert.match(workflow, /--scope=wide/);
});
