import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const knownWorkflow = new URL("../.github/workflows/refresh-known-transfermarkt-players.yml", import.meta.url);
const discoveryWorkflow = new URL("../.github/workflows/refresh-transfermarkt-and-publish.yml", import.meta.url);
const monthlyWideWorkflow = new URL("../.github/workflows/refresh-wide-transfermarkt-monthly.yml", import.meta.url);

test("scheduled refresh is a small weekly stale-cache batch with a hard Apify ceiling", async () => {
  const workflow = await readFile(knownWorkflow, "utf8");
  const crons = [...workflow.matchAll(/cron: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(crons, ["15 5 * * 1"]);
  assert.match(workflow, /REFRESH_EDITION: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.edition \|\| 'daily' \}\}/);
  assert.match(workflow, /CUSTOM_LIMIT: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.customLimit \|\| '' \}\}/);
  assert.match(workflow, /MIN_AGE_DAYS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.minAgeDays \|\| '21' \}\}/);
  assert.match(workflow, /APIFY_BUDGET_MAX_ITEMS: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.budgetMaxItems \|\| '75' \}\}/);
  assert.match(workflow, /--limit=50/);
  assert.match(workflow, /--minAgeDays="\$MIN_AGE_DAYS"/);
  assert.match(workflow, /--budgetMaxItems="\$APIFY_BUDGET_MAX_ITEMS"/);
  assert.match(workflow, /--batchSize=2/);
  assert.match(workflow, /--maxItems=75/);
  assert.match(workflow, /restore-zero-market-values\.js/);
  assert.match(workflow, /daily-transfermarkt-new-players-report\.json/);
});

test("full playable-club reconciliation is manual-only with a conservative default", async () => {
  const workflow = await readFile(discoveryWorkflow, "utf8");
  const crons = [...workflow.matchAll(/cron: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(crons, []);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /default: "500"/);
  assert.match(workflow, /MAX_ITEMS: \$\{\{ inputs\.maxItems \|\| '500' \}\}/);
  assert.match(workflow, /--budgetMaxItems="\$MAX_ITEMS"/);
  assert.match(workflow, /--scope=universe/);
  assert.match(workflow, /--scope=wide/);
});

test("wider-competition reconciliation is manual-only", async () => {
  const workflow = await readFile(monthlyWideWorkflow, "utf8");
  const crons = [...workflow.matchAll(/cron: "([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(crons, []);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /default: "1000"/);
  assert.match(workflow, /MAX_ITEMS: \$\{\{ inputs\.maxItems \|\| '1000' \}\}/);
  assert.match(workflow, /--scope=wide/);
  assert.match(workflow, /--budgetMaxItems="\$MAX_ITEMS"/);
});
