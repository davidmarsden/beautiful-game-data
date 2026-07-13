import { access, readFile, writeFile, mkdir } from "node:fs/promises";
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
  try { await access(path); return true; } catch { return false; }
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function normaliseText(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "").replace(/[ø]/g, "o").replace(/[Ø]/g, "O").replace(/[æ]/g, "ae").replace(/[Æ]/g, "AE").replace(/[ß]/g, "ss").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
}

function tbgIdFromTransfermarktId(id) { return `tbg-tm-${String(id).padStart(8, "0")}`; }
function asArray(value) { if (Array.isArray(value)) return value.filter(Boolean).map(String); if (value === undefined || value === null || value === "") return []; return [String(value)]; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }

function registryRecordFromTransfermarkt(row, existing = null) {
  const transfermarktId = String(row.transfermarkt_id ?? row.player_id ?? "").trim();
  if (!transfermarktId) return null;
  const displayName = row.display_name || row.short_name || row.full_name || existing?.canonical_name || "";
  const fullName = row.full_name || displayName;
  const aliases = unique([...(existing?.aliases ?? []), displayName, fullName, row.short_name, row.nickname].map((value) => String(value ?? "").trim()).filter((value) => value && value !== displayName));
  const sourceStatus = String(row.status || row.player_status || row.current_status || existing?.status || "active").trim().toLowerCase();
  const retired = sourceStatus.includes("retired") || String(row.current_club || "").trim().toLowerCase() === "retired";
  return {
    tbg_player_id: existing?.tbg_player_id || tbgIdFromTransfermarktId(transfermarktId),
    canonical_name: existing?.canonical_name || displayName,
    display_name: displayName,
    full_name: fullName,
    name_key: normaliseText(displayName),
    full_name_key: normaliseText(fullName),
    aliases,
    alias_keys: unique(aliases.map(normaliseText)),
    date_of_birth: row.date_of_birth || existing?.date_of_birth || "",
    nationality: unique([...(existing?.nationality ?? []), ...asArray(row.nationality)]),
    primary_position: row.position || existing?.primary_position || "",
    position_category: row.position_category || existing?.position_category || "",
    transfermarkt_id: transfermarktId,
    transfermarkt_profile_url: row.profile_url || existing?.transfermarkt_profile_url || "",
    soccerwiki_id: existing?.soccerwiki_id || "",
    soccerwiki_url: existing?.soccerwiki_url || "",
    api_football_id: existing?.api_football_id || "",
    api_football_team_id: existing?.api_football_team_id || "",
    current_club: row.current_club || existing?.current_club || "",
    current_competition_code: row.current_competition_code || existing?.current_competition_code || "",
    first_seen_source: existing?.first_seen_source || "transfermarkt",
    last_seen_source: "transfermarkt",
    last_seen_at: row.scraped_at || new Date().toISOString(),
    status: retired ? "retired" : (sourceStatus || "active"),
    tbg_publish_eligible: row.tbg_publish_eligible ?? existing?.tbg_publish_eligible ?? true,
    tbg_exclusion_reasons: row.tbg_exclusion_reasons ?? existing?.tbg_exclusion_reasons ?? [],
    tbg_eligibility_checked_at: row.tbg_eligibility_checked_at || existing?.tbg_eligibility_checked_at || "",
    notes: existing?.notes || ""
  };
}

function mergeRegistry(existingRows, transfermarktRows) {
  const byTmId = new Map(); const byTbgId = new Map();
  for (const row of existingRows) { if (row.transfermarkt_id) byTmId.set(String(row.transfermarkt_id), row); if (row.tbg_player_id) byTbgId.set(String(row.tbg_player_id), row); }
  const merged = []; const touched = new Set();
  for (const tmRow of transfermarktRows) {
    const tmId = String(tmRow.transfermarkt_id ?? tmRow.player_id ?? "").trim();
    if (!tmId) continue;
    const existing = byTmId.get(tmId) || byTbgId.get(tbgIdFromTransfermarktId(tmId));
    const record = registryRecordFromTransfermarkt(tmRow, existing);
    if (!record) continue;
    touched.add(record.tbg_player_id); merged.push(record);
  }
  for (const row of existingRows) { if (touched.has(row.tbg_player_id)) continue; merged.push({ ...row, status: row.status || "inactive" }); }
  return merged.sort((a, b) => String(a.canonical_name).localeCompare(String(b.canonical_name)) || String(a.tbg_player_id).localeCompare(String(b.tbg_player_id)));
}

function writeCsv(records) {
  const headers = ["tbg_player_id", "canonical_name", "display_name", "full_name", "name_key", "date_of_birth", "nationality", "primary_position", "position_category", "transfermarkt_id", "soccerwiki_id", "api_football_id", "current_club", "current_competition_code", "status", "tbg_publish_eligible", "tbg_exclusion_reasons", "last_seen_source", "last_seen_at"];
  return [headers.join(","), ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(","))].join("\n") + "\n";
}

function buildSummary(records) {
  return {
    player_count: records.length,
    active_players: records.filter((row) => row.status === "active").length,
    publication_eligible: records.filter((row) => row.tbg_publish_eligible !== false).length,
    publication_excluded: records.filter((row) => row.tbg_publish_eligible === false).length,
    transfermarkt_linked: records.filter((row) => row.transfermarkt_id).length,
    soccerwiki_linked: records.filter((row) => row.soccerwiki_id).length,
    api_football_linked: records.filter((row) => row.api_football_id).length,
    generated_at: new Date().toISOString()
  };
}

const args = parseArgs(process.argv.slice(2));
const transfermarktPath = args.transfermarkt ?? "data/transfermarkt/players-master.json";
const registryJsonPath = args.registryJson ?? "data/players/player-registry.json";
const registryCsvPath = args.registryCsv ?? "data/players/player-registry.csv";
const summaryPath = args.summary ?? "data/players/player-registry-summary.json";
const transfermarktRows = JSON.parse(await readFile(transfermarktPath, "utf8"));
const existingRows = await exists(registryJsonPath) ? JSON.parse(await readFile(registryJsonPath, "utf8")) : [];
const registry = mergeRegistry(existingRows, transfermarktRows);
for (const path of [registryJsonPath, registryCsvPath, summaryPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(registryJsonPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
await writeFile(registryCsvPath, writeCsv(registry), "utf8");
await writeFile(summaryPath, JSON.stringify(buildSummary(registry), null, 2) + "\n", "utf8");
console.log(`Built player registry with ${registry.length} record(s).`);
console.log(`Wrote registry JSON: ${registryJsonPath}`);
console.log(`Wrote registry CSV: ${registryCsvPath}`);
console.log(`Wrote registry summary: ${summaryPath}`);
