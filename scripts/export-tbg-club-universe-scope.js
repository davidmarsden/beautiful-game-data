import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function groupBy(items, keyFn) {
  return items.reduce((memo, item) => {
    const key = keyFn(item);
    memo[key] = memo[key] || [];
    memo[key].push(item);
    return memo;
  }, {});
}

const args = parseArgs(process.argv.slice(2));
const universePath = args.universe ?? "data/config/tbg-club-universe.json";
const outputPath = args.output ?? "derived/tbg-club-universe/import-scope.json";
const githubOutputPath = process.env.GITHUB_OUTPUT;

const universe = JSON.parse(await readFile(universePath, "utf8"));
const clubs = universe.clubs || [];
const clubIds = unique(clubs.map((club) => club.transfermarkt_club_id));
const searchQueries = unique(clubs.filter((club) => !club.transfermarkt_club_id).map((club) => club.name));
const flaggedForReview = clubs.filter((club) => club.needs_transfermarkt_id_review || !club.transfermarkt_club_id);
const duplicateIds = Object.entries(groupBy(clubs.filter((club) => club.transfermarkt_club_id), (club) => club.transfermarkt_club_id))
  .filter(([, grouped]) => grouped.length > 1)
  .map(([transfermarkt_club_id, grouped]) => ({ transfermarkt_club_id, clubs: grouped.map((club) => club.name) }));

const scope = {
  universe_version: universe.version,
  playable_clubs: clubs.length,
  club_ids: clubIds,
  club_ids_csv: clubIds.join(","),
  search_queries: searchQueries,
  search_queries_csv: searchQueries.join(","),
  continent_targets: universe.continent_targets || {},
  flagged_for_review: flaggedForReview,
  duplicate_transfermarkt_club_ids: duplicateIds,
  clubs_missing_transfermarkt_id: clubs.filter((club) => !club.transfermarkt_club_id).map((club) => ({ slot: club.slot, name: club.name, continent: club.continent, country: club.country }))
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(scope, null, 2) + "\n", "utf8");

if (githubOutputPath) {
  await writeFile(githubOutputPath, `club_ids=${scope.club_ids_csv}\nsearch_queries=${scope.search_queries_csv}\n`, { flag: "a" });
}

console.log(JSON.stringify({
  universe_version: scope.universe_version,
  playable_clubs: scope.playable_clubs,
  club_ids: scope.club_ids.length,
  search_queries: scope.search_queries.length,
  flagged_for_review: scope.flagged_for_review.length,
  duplicate_transfermarkt_club_ids: scope.duplicate_transfermarkt_club_ids.length
}, null, 2));
if (scope.flagged_for_review.length) {
  console.log("Flagged for Transfermarkt ID review:");
  console.table(scope.flagged_for_review.map((club) => ({ slot: club.slot, name: club.name, id: club.transfermarkt_club_id || "", continent: club.continent })));
}
if (scope.duplicate_transfermarkt_club_ids.length) {
  console.log("Duplicate Transfermarkt club IDs:");
  console.table(scope.duplicate_transfermarkt_club_ids);
}
