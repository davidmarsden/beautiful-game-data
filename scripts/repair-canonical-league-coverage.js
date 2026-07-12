import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  return Object.fromEntries(argv.map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: process.platform === "win32"
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return !["false", "0", "no", "off"].includes(String(value).toLowerCase());
}

function snapshot(report) {
  return {
    generated_at: report.generated_at,
    totals: report.totals,
    leagues: (report.leagues || []).map((league) => ({
      key: league.key,
      league: league.league,
      imported_players: league.imported_players,
      published_players: league.published_players,
      clubs_complete: league.clubs_complete,
      clubs_thin: league.clubs_thin,
      clubs_missing: league.clubs_missing,
      status: league.status
    }))
  };
}

const args = parseArgs(process.argv.slice(2));
const auditPath = args.audit || "derived/player-universe/league-player-coverage-audit.json";
const planPath = args.plan || "derived/player-universe/canonical-league-repair-plan.json";
const resultPath = args.result || "derived/player-universe/canonical-league-repair-result.json";
const includeThin = bool(args.includeThin, true);
const dryRun = bool(args.dryRun, false);
const selectedLeagueKeys = new Set(csv(args.leagueKeys));
const selectedStatuses = new Set(csv(args.statuses).length
  ? csv(args.statuses)
  : includeThin ? ["missing", "thin"] : ["missing"]);

console.log("Refreshing canonical league coverage audit...");
await run("npm", ["run", "audit:league-coverage"]);
const before = await readJson(auditPath);

const clubs = (before.leagues || [])
  .filter((league) => !selectedLeagueKeys.size || selectedLeagueKeys.has(league.key))
  .flatMap((league) => (league.club_reports || [])
    .filter((club) => selectedStatuses.has(club.status))
    .map((club) => ({
      league_key: league.key,
      league: league.league,
      club_id: String(club.club_id || "").trim(),
      club_name: club.club_name,
      status: club.status,
      imported_players: club.imported_players,
      published_players: club.published_players
    })))
  .filter((club) => club.club_id);

const clubIds = [...new Set(clubs.map((club) => club.club_id))];
const maxItems = Number(args.maxItems) > 0
  ? Number(args.maxItems)
  : Math.max(500, clubIds.length * 50);

const plan = {
  generated_at: new Date().toISOString(),
  audit_generated_at: before.generated_at,
  season: before.season,
  methodology: before.methodology,
  selected_statuses: [...selectedStatuses],
  selected_league_keys: [...selectedLeagueKeys],
  club_count: clubs.length,
  club_ids: clubIds,
  max_items: maxItems,
  dry_run: dryRun,
  clubs
};

await mkdir(dirname(planPath), { recursive: true });
await writeFile(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
console.log(`Wrote canonical league repair plan: ${planPath}`);

if (!clubIds.length) {
  const result = {
    generated_at: new Date().toISOString(),
    status: "nothing-to-repair",
    plan,
    before: snapshot(before),
    after: snapshot(before)
  };
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log("No missing or thin canonical clubs matched the repair scope.");
  process.exit(0);
}

console.log(`Canonical repair scope: ${clubs.length} clubs (${clubIds.join(", ")})`);
for (const club of clubs) {
  console.log(`- ${club.league}: ${club.club_name} [${club.club_id}] (${club.status}, ${club.imported_players} imported)`);
}

if (dryRun) {
  const result = {
    generated_at: new Date().toISOString(),
    status: "dry-run",
    plan,
    before: snapshot(before),
    after: null
  };
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log("Dry run complete; no Transfermarkt import was started.");
  process.exit(0);
}

const importArgs = [
  "scripts/import-transfermarkt-targeted.js",
  `--clubIds=${clubIds.join(",")}`,
  `--maxItems=${maxItems}`
];
if (args.datasetId) importArgs.push(`--datasetId=${args.datasetId}`);

console.log("Importing canonical missing/thin club squads...");
await run("node", importArgs);
console.log("Rebuilding rated pools and published player database...");
await run("npm", ["run", "rebuild:published-player-database"]);

const after = await readJson(auditPath);
const remaining = (after.leagues || []).flatMap((league) => (league.club_reports || [])
  .filter((club) => selectedStatuses.has(club.status))
  .map((club) => ({
    league_key: league.key,
    league: league.league,
    club_id: club.club_id,
    club_name: club.club_name,
    status: club.status,
    imported_players: club.imported_players,
    published_players: club.published_players
  })));

const result = {
  generated_at: new Date().toISOString(),
  status: remaining.length ? "completed-with-remaining-gaps" : "completed",
  plan,
  before: snapshot(before),
  after: snapshot(after),
  changes: {
    imported_players: (after.totals?.imported_players || 0) - (before.totals?.imported_players || 0),
    published_players: (after.totals?.published_players || 0) - (before.totals?.published_players || 0),
    clubs_complete: (after.totals?.clubs_complete || 0) - (before.totals?.clubs_complete || 0),
    clubs_thin: (after.totals?.clubs_thin || 0) - (before.totals?.clubs_thin || 0),
    clubs_missing: (after.totals?.clubs_missing || 0) - (before.totals?.clubs_missing || 0)
  },
  remaining_repair_clubs: remaining
};

await mkdir(dirname(resultPath), { recursive: true });
await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(`Wrote canonical league repair result: ${resultPath}`);
console.log(JSON.stringify({ status: result.status, changes: result.changes, remaining_repair_clubs: remaining.length }, null, 2));
