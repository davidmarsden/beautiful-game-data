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

const args = parseArgs(process.argv.slice(2));
const mode = String(args.mode || "daily");
const masterPath = args.master || "data/transfermarkt/players-master.json";
const publishedPath = args.published || "derived/player-database/player-database.json";
const policyPath = args.policy || "data/config/transfermarkt-refresh-tiers.json";
const statePath = args.state || "calibration/transfermarkt-refresh-rotation-state.json";
const outputPath = args.output || `calibration/transfermarkt-refresh-${mode}-ids.json`;
const reportPath = args.report || `calibration/transfermarkt-refresh-${mode}-batch-report.json`;

const [masterRaw, publishedRaw, policy] = await Promise.all([
  readFile(masterPath, "utf8").then(JSON.parse),
  readFile(publishedPath, "utf8").then(JSON.parse),
  readFile(policyPath, "utf8").then(JSON.parse)
]);
const master = Array.isArray(masterRaw) ? masterRaw : masterRaw.players || [];
const published = Array.isArray(publishedRaw) ? publishedRaw : publishedRaw.players || [];
const rules = policy[mode];
if (!rules) throw new Error(`Unknown refresh mode: ${mode}`);

let state = { offsets: {} };
try { state = JSON.parse(await readFile(statePath, "utf8")); } catch {}
const publishedById = new Map(published.map((row) => [String(row.transfermarkt_id || row.transfermarkt_player_id || ""), row]));
const retired = (row) => /retired/i.test(String(row.status || row.player_status || row.current_club || ""));
const eligible = master.filter((row) => !retired(row) && /^\d+$/.test(String(row.transfermarkt_id || row.player_id || "")));
const sortedIds = eligible.map((row) => String(row.transfermarkt_id || row.player_id)).sort((a, b) => Number(a) - Number(b));
const offset = Number(state.offsets?.[mode] || 0) % Math.max(1, sortedIds.length);
const rotationRank = new Map(sortedIds.map((id, index) => [id, (index - offset + sortedIds.length) % sortedIds.length]));

const scored = eligible.map((row) => {
  const id = String(row.transfermarkt_id || row.player_id);
  const pub = publishedById.get(id) || {};
  const assigned = pub.assignment_status === "assigned" || Boolean(pub.tbg_club);
  const rating = Number(pub.tbg_rating || 0);
  const age = Number(row.age || pub.age || 99);
  const value = Number(row.market_value_eur || pub.market_value_eur || 0);
  let score = 0;
  const reasons = [];
  if (assigned) { score += rules.assigned_weight; reasons.push("assigned"); }
  if (rating >= rules.elite_rating_floor) { score += rules.elite_weight + rating; reasons.push("high_rating"); }
  if (age <= rules.young_age_max) { score += rules.young_weight + Math.max(0, 24 - age); reasons.push("young"); }
  if (value >= rules.market_value_floor_eur) { score += rules.valuable_weight + Math.log10(Math.max(1, value)); reasons.push("valuable"); }
  const rank = rotationRank.get(id) ?? sortedIds.length;
  score += rules.rotation_weight * (1 - rank / Math.max(1, sortedIds.length));
  return { id, score, reasons, player_name: row.display_name || row.full_name || "", age, value, rating, assigned, rotation_rank: rank };
});

scored.sort((a, b) => b.score - a.score || a.rotation_rank - b.rotation_rank || Number(a.id) - Number(b.id));
const selected = scored.slice(0, Number(args.limit || rules.limit));
const ids = selected.map((row) => row.id);
state.offsets = state.offsets || {};
state.offsets[mode] = (offset + ids.length) % Math.max(1, sortedIds.length);
state.updated_at = new Date().toISOString();

const report = {
  generated_at: new Date().toISOString(),
  policy_version: policy.version,
  mode,
  description: rules.description,
  master_players: master.length,
  eligible_known_players: eligible.length,
  retired_excluded: master.length - eligible.length,
  requested_players: ids.length,
  rotation_offset_before: offset,
  rotation_offset_after: state.offsets[mode],
  composition: {
    assigned: selected.filter((row) => row.assigned).length,
    high_rating: selected.filter((row) => row.reasons.includes("high_rating")).length,
    young: selected.filter((row) => row.reasons.includes("young")).length,
    valuable: selected.filter((row) => row.reasons.includes("valuable")).length
  },
  players: selected
};

for (const path of [outputPath, reportPath, statePath]) await mkdir(dirname(path), { recursive: true });
await writeFile(outputPath, JSON.stringify(ids, null, 2) + "\n", "utf8");
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ mode, requested: ids.length, eligible: eligible.length, retired_excluded: report.retired_excluded, composition: report.composition }, null, 2));
