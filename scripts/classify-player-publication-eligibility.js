import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

const text = (value) => String(value ?? "").trim();
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const lower = (value) => text(value).toLowerCase();
const args = parseArgs(process.argv.slice(2));
const masterPath = args.master || "data/transfermarkt/players-master.json";
const registryPath = args.registry || "data/players/player-registry.json";
const policyPath = args.policy || "data/config/player-publication-policy.json";
const ledgerPath = args.ledger || "derived/player-eligibility/player-exclusion-ledger.json";
const markdownPath = args.markdown || "derived/player-eligibility/player-exclusion-ledger.md";
const activeRegistryPath = args.activeRegistry || "derived/player-eligibility/active-player-registry.json";
const eligibleMasterPath = args.eligibleMaster || "derived/player-eligibility/eligible-player-master.json";

const [masterRaw, registryRaw, policy] = await Promise.all([
  readFile(masterPath, "utf8").then(JSON.parse),
  readFile(registryPath, "utf8").then(JSON.parse),
  readFile(policyPath, "utf8").then(JSON.parse)
]);
const master = Array.isArray(masterRaw) ? masterRaw : masterRaw.players || [];
const registry = Array.isArray(registryRaw) ? registryRaw : registryRaw.players || [];
const rules = policy.active_database;
const registryByTmId = new Map(registry.map((row) => [text(row.transfermarkt_id), row]).filter(([id]) => id));
const idCounts = master.reduce((memo, row) => {
  const id = text(row.transfermarkt_id || row.player_id);
  if (id) memo.set(id, (memo.get(id) || 0) + 1);
  return memo;
}, new Map());

function isStaff(row) {
  const haystack = [row.position, row.position_category, row.role, row.occupation, row.status].map(lower).join(" ");
  return /\b(coach|manager|assistant manager|sporting director|director|president|staff|scout|physio|analyst)\b/.test(haystack);
}

function daysWithoutClub(row) {
  const date = row.without_club_since || row.contract_expired_at || row.last_club_date || "";
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((Date.now() - parsed.getTime()) / 86400000);
}

function classify(row) {
  const reasons = [];
  const tmId = text(row.transfermarkt_id || row.player_id);
  const name = text(row.display_name || row.short_name || row.full_name);
  const age = number(row.age);
  const status = lower(row.status || row.player_status || row.current_status);
  const club = lower(row.current_club);
  if (rules.require_transfermarkt_id && !/^\d+$/.test(tmId)) reasons.push("INVALID_TRANSFERMARKT_RECORD");
  if (rules.require_player_name && !name) reasons.push("INVALID_TRANSFERMARKT_RECORD");
  if (age === null || age < rules.minimum_age || age > rules.maximum_age) reasons.push("INVALID_TRANSFERMARKT_RECORD");
  if (rules.exclude_retired && (status.includes("retired") || club === "retired")) reasons.push("RETIRED");
  if (rules.exclude_staff_records && isStaff(row)) reasons.push("STAFF_NOT_PLAYER");
  if (rules.exclude_duplicate_transfermarkt_ids && tmId && (idCounts.get(tmId) || 0) > 1) reasons.push("DUPLICATE");
  if (rules.exclude_under_review && (row.under_review === true || status === "under_review" || status === "under review")) reasons.push("UNDER_REVIEW");
  const maxDays = number(rules.without_club_max_days);
  const withoutDays = daysWithoutClub(row);
  if (maxDays !== null && withoutDays !== null && withoutDays > maxDays && (club === "without club" || status.includes("without club") || status.includes("free agent"))) reasons.push("WITHOUT_CLUB_TOO_LONG");
  return [...new Set(reasons)];
}

const exclusions = [];
for (const row of master) {
  const tmId = text(row.transfermarkt_id || row.player_id);
  const reasons = classify(row);
  const eligible = reasons.length === 0;
  row.tbg_publish_eligible = eligible;
  row.tbg_exclusion_reasons = reasons;
  row.tbg_eligibility_checked_at = new Date().toISOString();
  const registryRow = registryByTmId.get(tmId);
  if (registryRow) {
    registryRow.tbg_publish_eligible = eligible;
    registryRow.tbg_exclusion_reasons = reasons;
    registryRow.tbg_eligibility_checked_at = row.tbg_eligibility_checked_at;
    if (!eligible && reasons.includes("RETIRED")) registryRow.status = "retired";
  }
  if (!eligible) exclusions.push({
    transfermarkt_id: tmId,
    tbg_player_id: registryRow?.tbg_player_id || "",
    player_name: text(row.display_name || row.full_name),
    age: row.age ?? null,
    current_club: text(row.current_club),
    status: text(row.status || row.player_status),
    exclusion_reasons: reasons
  });
}

const activeRegistry = registry.filter((row) => row.tbg_publish_eligible !== false);
const eligibleMaster = master.filter((row) => row.tbg_publish_eligible !== false);
const reasonCounts = exclusions.flatMap((row) => row.exclusion_reasons).reduce((memo, reason) => {
  memo[reason] = (memo[reason] || 0) + 1;
  return memo;
}, {});
const ledger = {
  generated_at: new Date().toISOString(),
  policy_version: policy.version,
  master_players: master.length,
  registry_players: registry.length,
  active_registry_players: activeRegistry.length,
  eligible_master_players: eligibleMaster.length,
  excluded_players: exclusions.length,
  exclusion_reason_counts: reasonCounts,
  exclusion_codes: policy.exclusion_codes,
  players: exclusions
};
const lines = [
  "# Player Exclusion Ledger", "", `Generated: ${ledger.generated_at}`, "", `Policy: ${policy.version}`, "",
  `- Master players: ${master.length}`, `- Registry players: ${registry.length}`, `- Active registry players: ${activeRegistry.length}`, `- Eligible master players: ${eligibleMaster.length}`, `- Excluded players: ${exclusions.length}`, "",
  "## Reasons", "", ...Object.entries(reasonCounts).map(([reason, count]) => `- ${reason}: ${count}`), "", "## Excluded Players", "",
  ...exclusions.map((row) => `- ${row.player_name || row.transfermarkt_id} (${row.current_club || "No club"}): ${row.exclusion_reasons.join(", ")}`)
];

for (const path of [masterPath, registryPath, ledgerPath, markdownPath, activeRegistryPath, eligibleMasterPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(masterPath, JSON.stringify(masterRaw, null, 2) + "\n", "utf8");
await writeFile(registryPath, JSON.stringify(registryRaw, null, 2) + "\n", "utf8");
await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
await writeFile(markdownPath, lines.join("\n") + "\n", "utf8");
await writeFile(activeRegistryPath, JSON.stringify(activeRegistry, null, 2) + "\n", "utf8");
await writeFile(eligibleMasterPath, JSON.stringify(eligibleMaster, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ master_players: master.length, eligible_master_players: eligibleMaster.length, active_registry_players: activeRegistry.length, excluded_players: exclusions.length, exclusion_reason_counts: reasonCounts }, null, 2));
