import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalise(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function tmId(row) {
  return String(row.transfermarkt_id ?? row.player_id ?? "").trim();
}

function clubId(row) {
  return String(row.current_club_id ?? row.club_id ?? "").trim();
}

function playerName(row) {
  return row.display_name || row.short_name || row.full_name || row.canonical_name || "";
}

function duplicateIds(rows) {
  const counts = new Map();
  for (const row of rows) {
    const id = tmId(row);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ transfermarkt_id: id, count }));
}

function collectCanonicalClubIds(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectCanonicalClubIds(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const key of ["transfermarkt_club_id", "club_id", "transfermarkt_id"]) {
    const id = value[key];
    if (id !== undefined && id !== null && String(id).trim()) output.add(String(id).trim());
  }
  for (const child of Object.values(value)) collectCanonicalClubIds(child, output);
  return output;
}

function classifyMissing(row, registryByIdentity, canonicalClubIds) {
  const id = tmId(row);
  const currentClubId = clubId(row);
  const identityKey = `${normalise(playerName(row))}|${String(row.date_of_birth ?? "").trim()}`;
  const identityMatches = registryByIdentity.get(identityKey) ?? [];

  if (!id) return { category: "missing_transfermarkt_id", reason: "Master row has no Transfermarkt ID." };
  if (identityMatches.length) {
    return {
      category: "duplicate_or_identity_resolution",
      reason: "A registry record has the same normalised name and date of birth under a different Transfermarkt ID.",
      conflicting_registry_ids: identityMatches.map((match) => tmId(match)).filter(Boolean)
    };
  }
  if (currentClubId && canonicalClubIds.size && !canonicalClubIds.has(currentClubId)) {
    return {
      category: "club_eligibility_candidate",
      reason: "Player's current club is outside the configured canonical club universe.",
      current_club_id: currentClubId
    };
  }
  if (!currentClubId) {
    return {
      category: "canonical_club_mapping_candidate",
      reason: "Player has no current club ID, so canonical club membership cannot be established."
    };
  }
  return {
    category: "stale_registry_or_over_aggressive_filter",
    reason: "Player has a valid unique Transfermarkt ID and no detected identity or club-universe conflict; the registry is probably stale or was built from an older master file."
  };
}

function markdown(report) {
  const lines = [
    "# Player Registry Exclusion Diagnosis",
    "",
    `Generated: ${report.generated_at}`,
    `Phase: ${report.phase}`,
    "",
    `- Master players: ${report.totals.master_players}`,
    `- Registry players: ${report.totals.registry_players}`,
    `- Missing from registry: ${report.totals.missing_from_registry}`,
    `- Duplicate master Transfermarkt IDs: ${report.totals.duplicate_master_ids}`,
    `- Duplicate registry Transfermarkt IDs: ${report.totals.duplicate_registry_ids}`,
    "",
    "## Classification",
    ""
  ];
  for (const [category, count] of Object.entries(report.category_counts)) lines.push(`- ${category}: ${count}`);
  lines.push("", "## Missing players", "");
  if (!report.missing_players.length) lines.push("None.");
  for (const player of report.missing_players) {
    lines.push(`- ${player.player_name} (${player.transfermarkt_id || "no TM ID"}) — ${player.category} — ${player.reason}`);
  }
  return `${lines.join("\n")}\n`;
}

const args = parseArgs(process.argv.slice(2));
const masterPath = args.master ?? "data/transfermarkt/players-master.json";
const registryPath = args.registry ?? "data/players/player-registry.json";
const clubUniversePath = args.clubUniverse ?? "data/config/tbg-club-universe.json";
const phase = String(args.phase ?? "current");
const outputJson = args.outputJson ?? `derived/player-universe/player-registry-diagnosis-${phase}.json`;
const outputMarkdown = args.outputMarkdown ?? `derived/player-universe/player-registry-diagnosis-${phase}.md`;
const failOnMissing = String(args.failOnMissing ?? "false").toLowerCase() === "true";

const masterRows = JSON.parse(await readFile(masterPath, "utf8"));
const registryRows = JSON.parse(await readFile(registryPath, "utf8"));
const clubUniverse = await exists(clubUniversePath) ? JSON.parse(await readFile(clubUniversePath, "utf8")) : {};
const canonicalClubIds = collectCanonicalClubIds(clubUniverse);

const registryByTmId = new Map();
const registryByIdentity = new Map();
for (const row of registryRows) {
  const id = tmId(row);
  if (id) registryByTmId.set(id, row);
  const key = `${normalise(playerName(row))}|${String(row.date_of_birth ?? "").trim()}`;
  if (!registryByIdentity.has(key)) registryByIdentity.set(key, []);
  registryByIdentity.get(key).push(row);
}

const missingPlayers = masterRows
  .filter((row) => !registryByTmId.has(tmId(row)))
  .map((row) => ({
    transfermarkt_id: tmId(row),
    player_name: playerName(row),
    current_club: row.current_club || "",
    current_club_id: clubId(row),
    age: row.age ?? null,
    market_value_eur: row.market_value_eur ?? null,
    ...classifyMissing(row, registryByIdentity, canonicalClubIds)
  }));

const categoryCounts = {};
for (const row of missingPlayers) categoryCounts[row.category] = (categoryCounts[row.category] ?? 0) + 1;

const masterDuplicates = duplicateIds(masterRows);
const registryDuplicates = duplicateIds(registryRows);
const report = {
  generated_at: new Date().toISOString(),
  phase,
  inputs: { master: masterPath, registry: registryPath, club_universe: clubUniversePath },
  totals: {
    master_players: masterRows.length,
    registry_players: registryRows.length,
    missing_from_registry: missingPlayers.length,
    duplicate_master_ids: masterDuplicates.length,
    duplicate_registry_ids: registryDuplicates.length,
    canonical_club_ids: canonicalClubIds.size
  },
  category_counts: categoryCounts,
  duplicate_master_ids: masterDuplicates,
  duplicate_registry_ids: registryDuplicates,
  missing_players: missingPlayers
};

for (const path of [outputJson, outputMarkdown]) await mkdir(dirname(path), { recursive: true });
await writeFile(outputJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(outputMarkdown, markdown(report), "utf8");

console.log(`Player registry diagnosis (${phase}): ${missingPlayers.length} master player(s) missing from registry.`);
console.log(`Classification: ${JSON.stringify(categoryCounts)}`);
console.log(`Wrote ${outputJson}`);
console.log(`Wrote ${outputMarkdown}`);

if (failOnMissing && missingPlayers.length) {
  console.error(`Registry still excludes ${missingPlayers.length} master player(s).`);
  process.exitCode = 1;
}
