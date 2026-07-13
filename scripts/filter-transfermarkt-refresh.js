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
const truthy = (value) => value === true || value === "true" || value === "1";
const args = parseArgs(process.argv.slice(2));
const inputPath = args.input;
const outputPath = args.output;
const reportPath = args.report || `${outputPath}.report.json`;
const zeroIdsPath = args.zeroIds || `${outputPath}.zero-value-ids.json`;
const policyPath = args.policy || "data/config/transfermarkt-refresh-policy.json";
const bridgeZeroValues = truthy(args.bridgeZeroValues);

if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/filter-transfermarkt-refresh.js --input=raw.json --output=accepted.json [--report=report.json] [--bridgeZeroValues=true]");
  process.exit(1);
}

const [raw, policy] = await Promise.all([
  readFile(inputPath, "utf8").then(JSON.parse),
  readFile(policyPath, "utf8").then(JSON.parse)
]);
const rows = Array.isArray(raw) ? raw : raw.items || raw.data || [];
const rules = policy.new_player_inclusion;
const accepted = [];
const rejected = [];
const zeroValueIds = [];

for (const row of rows) {
  const id = text(row.transfermarkt_id ?? row.player_id);
  const name = text(row.display_name || row.short_name || row.full_name);
  const age = number(row.age);
  const status = text(row.status || row.player_status || row.transfermarkt_status || row.current_status).toLowerCase();
  const club = text(row.current_club).toLowerCase();
  const marketValue = number(row.market_value_eur);
  const reasons = [];
  if (rules.require_transfermarkt_id && !id) reasons.push("missing_transfermarkt_id");
  if (rules.require_name && !name) reasons.push("missing_name");
  if (age === null || age < rules.minimum_age || age > rules.maximum_age) reasons.push("age_outside_policy");
  if (rules.exclude_retired && (status.includes("retired") || club === "retired")) reasons.push("retired");
  if (!rules.include_without_club && (/without club|free agent|unattached/.test(status) || club === "without club")) reasons.push("without_club_excluded");
  if (!rules.include_zero_market_value && !(marketValue > 0)) reasons.push("zero_value_excluded");
  if (reasons.length) {
    rejected.push({ transfermarkt_id: id, player_name: name, age, reasons });
    continue;
  }
  if (rules.include_zero_market_value && !(marketValue > 0)) {
    zeroValueIds.push(id);
    accepted.push(bridgeZeroValues ? { ...row, market_value_eur: 1, tbg_zero_value_bridge: true } : row);
  } else accepted.push(row);
}

const report = {
  generated_at: new Date().toISOString(),
  policy_version: policy.version,
  input: inputPath,
  scanned: rows.length,
  accepted: accepted.length,
  rejected: rejected.length,
  zero_value_players: zeroValueIds.length,
  rejection_counts: rejected.flatMap((row) => row.reasons).reduce((memo, reason) => ({ ...memo, [reason]: (memo[reason] || 0) + 1 }), {}),
  rejected_players: rejected
};
await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(reportPath), { recursive: true });
await mkdir(dirname(zeroIdsPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(accepted, null, 2) + "\n", "utf8");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
await writeFile(zeroIdsPath, JSON.stringify(zeroValueIds, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ scanned: report.scanned, accepted: report.accepted, rejected: report.rejected, zero_value_players: report.zero_value_players, rejection_counts: report.rejection_counts }, null, 2));
