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
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  if (/[,"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function normaliseText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[ø]/g, "o")
    .replace(/[Ø]/g, "O")
    .replace(/[æ]/g, "ae")
    .replace(/[Æ]/g, "AE")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latestHistoryEntry(history) {
  const entries = asArray(history);
  return entries.length ? entries[entries.length - 1] : "";
}

function currentClubFromHistoryFallback(row) {
  const latest = latestHistoryEntry(row.market_value_history);
  if (!latest || typeof latest !== "string") return "";
  const parts = latest.split("|").map((part) => part.trim());
  return parts.length >= 2 ? parts[1] : "";
}

function playerStatus(row, club) {
  const raw = String(row.status || row.player_status || row.transfermarkt_status || row.current_status || "").trim();
  const clubKey = normaliseText(club);
  if (/retired/i.test(raw)) return "retired";
  if (/without club|free agent|unattached/i.test(raw) || clubKey === "without club") return "without_club";
  return raw || "active";
}

function buildMasterRecord(row) {
  const displayName = row.display_name || row.short_name || row.full_name || "";
  const club = row.current_club || currentClubFromHistoryFallback(row);
  const nationality = asArray(row.nationality).map(String).filter(Boolean);
  const nationalTeamHistory = asArray(row.national_team_history).map(String).filter(Boolean);
  const marketValueHistory = asArray(row.market_value_history).map(String).filter(Boolean);
  const careerHistory = asArray(row.career_history).map(String).filter(Boolean);
  const injuries = asArray(row.injuries).map(String).filter(Boolean);
  const suspensions = asArray(row.suspensions).map(String).filter(Boolean);
  const transfermarktId = String(row.transfermarkt_id ?? row.player_id ?? "");

  return {
    player_id: transfermarktId,
    transfermarkt_id: transfermarktId,
    profile_url: row.profile_url || "",
    full_name: row.full_name || displayName,
    display_name: displayName,
    short_name: row.short_name || "",
    nickname: row.nickname || "",
    name_key: normaliseText(displayName || row.full_name),
    full_name_key: normaliseText(row.full_name || displayName),
    date_of_birth: row.date_of_birth || "",
    age: asNumber(row.age),
    status: playerStatus(row, club),
    transfermarkt_status: row.status || row.player_status || row.transfermarkt_status || row.current_status || "",
    place_of_birth: row.place_of_birth || "",
    country_of_birth: row.country_of_birth || "",
    nationality,
    gender: row.gender || "",
    position: row.position || "",
    position_category: row.position_category || "",
    foot: row.foot || "",
    height_cm: asNumber(row.height_cm),
    current_club: club,
    current_club_id: String(row.current_club_id ?? ""),
    current_competition: row.current_competition || "",
    current_competition_code: row.current_competition_code || "",
    shirt_number: asNumber(row.shirt_number),
    is_captain: Boolean(row.is_captain),
    contract_until: row.contract_until || "",
    last_contract_renewal: row.last_contract_renewal || "",
    market_value_eur: asNumber(row.market_value_eur),
    market_value_currency: row.market_value_currency || "EUR",
    market_value_determined: row.market_value_determined || "",
    previous_market_value_eur: asNumber(row.previous_market_value_eur),
    highest_market_value_eur: asNumber(row.highest_market_value_eur),
    highest_market_value_determined: row.highest_market_value_determined || "",
    market_value_history: marketValueHistory,
    agent: row.agent || "",
    agency: row.agency || "",
    agency_id: String(row.agency_id ?? ""),
    youth_clubs: asArray(row.youth_clubs).map(String).filter(Boolean),
    career_history: careerHistory,
    total_transfer_fees_eur: asNumber(row.total_transfer_fees_eur),
    international_team: row.international_team || "",
    international_caps: asNumber(row.international_caps) ?? 0,
    international_goals: asNumber(row.international_goals) ?? 0,
    national_team_history: nationalTeamHistory,
    injuries,
    suspensions,
    photo_url: row.photo_url || "",
    scraped_at: row.scraped_at || "",
    source: row.source || "apify-transfermarkt-global-player-scraper"
  };
}

function dedupe(records) {
  const byId = new Map();
  for (const record of records) {
    const key = record.transfermarkt_id || `${record.name_key}|${record.date_of_birth}|${record.current_club}`;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, record);
      continue;
    }
    const existingValue = existing.market_value_eur ?? 0;
    const nextValue = record.market_value_eur ?? 0;
    const existingScrapedAt = Date.parse(existing.scraped_at || "") || 0;
    const nextScrapedAt = Date.parse(record.scraped_at || "") || 0;
    if (nextScrapedAt > existingScrapedAt || (nextScrapedAt === existingScrapedAt && nextValue >= existingValue)) byId.set(key, { ...existing, ...record });
  }
  return [...byId.values()].sort((a, b) => {
    const clubCompare = String(a.current_club).localeCompare(String(b.current_club));
    if (clubCompare) return clubCompare;
    return String(a.display_name).localeCompare(String(b.display_name));
  });
}

function writeCsv(records, headers) {
  return [headers.join(","), ...records.map((record) => headers.map((header) => csvEscape(record[header])).join(","))].join("\n") + "\n";
}

function buildSummary(records) {
  const byCompetition = new Map();
  const byClub = new Map();
  const byStatus = new Map();
  const byPositionCategory = new Map();
  let totalValue = 0;
  let valuedPlayers = 0;

  for (const record of records) {
    const value = record.market_value_eur ?? 0;
    if (value > 0) {
      totalValue += value;
      valuedPlayers += 1;
    }
    const competition = record.current_competition_code || "UNKNOWN";
    const club = record.current_club || "UNKNOWN";
    const status = record.status || "unknown";
    const positionCategory = record.position_category || "UNKNOWN";
    byCompetition.set(competition, (byCompetition.get(competition) ?? 0) + 1);
    byClub.set(club, (byClub.get(club) ?? 0) + 1);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    byPositionCategory.set(positionCategory, (byPositionCategory.get(positionCategory) ?? 0) + 1);
  }

  const topMarketValues = [...records]
    .filter((record) => record.market_value_eur)
    .sort((a, b) => b.market_value_eur - a.market_value_eur)
    .slice(0, 30)
    .map((record) => ({
      player: record.display_name,
      club: record.current_club,
      status: record.status,
      position: record.position,
      market_value_eur: record.market_value_eur
    }));

  return {
    player_count: records.length,
    valued_players: valuedPlayers,
    total_market_value_eur: totalValue,
    average_market_value_eur: valuedPlayers ? Math.round(totalValue / valuedPlayers) : 0,
    statuses: Object.fromEntries([...byStatus.entries()].sort()),
    competitions: Object.fromEntries([...byCompetition.entries()].sort()),
    position_categories: Object.fromEntries([...byPositionCategory.entries()].sort()),
    clubs: Object.fromEntries([...byClub.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    top_market_values: topMarketValues
  };
}

const args = parseArgs(process.argv.slice(2));
if (!args.input) {
  console.error("Usage: node scripts/import-transfermarkt-master.js --input=calibration/apify-transfermarkt-dataset.json --masterJson=data/transfermarkt/players-master.json --masterCsv=data/transfermarkt/players-master.csv --valuesCsv=calibration/transfermarkt-values.csv [--mergeExisting=true]");
  process.exit(1);
}

const masterJsonPath = args.masterJson ?? "data/transfermarkt/players-master.json";
const masterCsvPath = args.masterCsv ?? "data/transfermarkt/players-master.csv";
const valuesCsvPath = args.valuesCsv ?? "calibration/transfermarkt-values.csv";
const summaryPath = args.summary ?? "data/transfermarkt/players-master-summary.json";
const mergeExisting = args.mergeExisting === true || args.mergeExisting === "true";

const input = JSON.parse(await readFile(args.input, "utf8"));
const rows = Array.isArray(input) ? input : input.items || input.data || [];
const importedRecords = rows.map(buildMasterRecord).filter((record) => record.display_name && record.market_value_eur);
const existingRecords = mergeExisting && await exists(masterJsonPath) ? JSON.parse(await readFile(masterJsonPath, "utf8")) : [];
const records = dedupe([...existingRecords, ...importedRecords]);

for (const path of [masterJsonPath, masterCsvPath, valuesCsvPath, summaryPath]) {
  await mkdir(dirname(path), { recursive: true });
}

await writeFile(masterJsonPath, JSON.stringify(records, null, 2) + "\n", "utf8");

const masterHeaders = [
  "transfermarkt_id",
  "display_name",
  "full_name",
  "name_key",
  "date_of_birth",
  "age",
  "status",
  "transfermarkt_status",
  "nationality",
  "position",
  "position_category",
  "foot",
  "height_cm",
  "current_club",
  "current_club_id",
  "current_competition_code",
  "contract_until",
  "market_value_eur",
  "previous_market_value_eur",
  "highest_market_value_eur",
  "market_value_determined",
  "international_team",
  "international_caps",
  "international_goals",
  "total_transfer_fees_eur",
  "profile_url",
  "photo_url",
  "source"
];
await writeFile(masterCsvPath, writeCsv(records, masterHeaders), "utf8");

const valueHeaders = ["player_name", "club", "status", "position", "age", "nationality", "market_value_eur", "market_value", "transfermarkt_url", "source"];
const valueRows = records.map((record) => ({
  player_name: record.display_name,
  club: record.current_club,
  status: record.status,
  position: record.position,
  age: record.age,
  nationality: record.nationality,
  market_value_eur: record.market_value_eur,
  market_value: record.market_value_eur ? `EUR ${record.market_value_eur}` : "",
  transfermarkt_url: record.profile_url,
  source: record.source
}));
await writeFile(valuesCsvPath, writeCsv(valueRows, valueHeaders), "utf8");

await writeFile(summaryPath, JSON.stringify(buildSummary(records), null, 2) + "\n", "utf8");

console.log(`Imported ${importedRecords.length} Transfermarkt player record(s).`);
if (mergeExisting) console.log(`Merged into ${existingRecords.length} existing Transfermarkt player record(s).`);
console.log(`Wrote ${records.length} total master record(s).`);
console.log(`Wrote master JSON: ${masterJsonPath}`);
console.log(`Wrote master CSV: ${masterCsvPath}`);
console.log(`Wrote rating-compatible values CSV: ${valuesCsvPath}`);
console.log(`Wrote summary: ${summaryPath}`);
