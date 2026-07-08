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

function normalise(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/football club|futbol club|sociedade esportiva|sport club|club atletico|atletico clube|associacao|association|de futbol|fc|cf|sc|ac|bc|fr|kv|jk|sfc|uanl|the|club/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function tokens(value) {
  return new Set(normalise(value).split(" ").filter((token) => token.length >= 3));
}

function jaccard(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function isNameMatch(expected, actual, aliases = []) {
  const expectedNorm = normalise(expected);
  const actualNorm = normalise(actual);
  if (!expectedNorm || !actualNorm) return false;
  if (expectedNorm === actualNorm) return true;
  if (expectedNorm.includes(actualNorm) || actualNorm.includes(expectedNorm)) return true;
  if (jaccard(expected, actual) >= 0.45) return true;
  return aliases.some((alias) => isNameMatch(alias, actual, []));
}

function byClubId(players) {
  const clubs = new Map();
  for (const player of players) {
    const id = String(player.current_club_id || "").trim();
    const name = String(player.current_club || "").trim();
    if (!id || !name) continue;
    if (!clubs.has(id)) clubs.set(id, { transfermarkt_club_id: id, imported_club_name: name, players: 0 });
    clubs.get(id).players += 1;
  }
  return clubs;
}

const args = parseArgs(process.argv.slice(2));
const universePath = args.universe ?? "data/config/tbg-club-universe.json";
const playersPath = args.players ?? "data/transfermarkt/players-master.json";
const outputPath = args.output ?? "derived/tbg-club-universe/match-audit.json";
const failOnMismatch = args.failOnMismatch !== "false";
const minPlayers = Number(args.minPlayers ?? 1);

const universe = JSON.parse(await readFile(universePath, "utf8"));
const players = JSON.parse(await readFile(playersPath, "utf8"));
const clubsById = byClubId(players);

const rows = (universe.clubs || []).map((club) => {
  const id = String(club.transfermarkt_club_id || "").trim();
  const imported = id ? clubsById.get(id) : null;
  const matched = imported ? isNameMatch(club.name, imported.imported_club_name, club.aliases || []) : false;
  const status = !id
    ? "missing_transfermarkt_club_id"
    : !imported
      ? "not_imported"
      : imported.players < minPlayers
        ? "too_few_players"
        : matched
          ? "ok"
          : "name_mismatch";
  return {
    slot: club.slot,
    expected_name: club.name,
    transfermarkt_club_id: id,
    imported_club_name: imported?.imported_club_name || "",
    imported_players: imported?.players || 0,
    continent: club.continent,
    country: club.country,
    league: club.league,
    status
  };
});

const summary = rows.reduce((memo, row) => {
  memo[row.status] = (memo[row.status] || 0) + 1;
  return memo;
}, {});

const report = {
  universe_version: universe.version,
  audited_at: new Date().toISOString(),
  summary,
  rows,
  problems: rows.filter((row) => row.status !== "ok")
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(JSON.stringify(summary, null, 2));
if (report.problems.length) {
  console.table(report.problems.map((row) => ({
    slot: row.slot,
    expected: row.expected_name,
    id: row.transfermarkt_club_id,
    imported: row.imported_club_name,
    players: row.imported_players,
    status: row.status
  })));
}

if (failOnMismatch && rows.some((row) => row.status === "name_mismatch")) {
  throw new Error("Club universe contains Transfermarkt ID/name mismatches. See derived/tbg-club-universe/match-audit.json.");
}
