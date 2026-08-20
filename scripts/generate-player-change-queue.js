import { createHash } from "node:crypto";
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
  try { await access(path); return true; } catch { return false; }
}

async function readJson(path, fallback = null) {
  if (!(await exists(path))) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

const text = (value) => String(value ?? "").trim();
const tmIdOf = (row = {}) => text(row.transfermarkt_id || row.transfermarkt_player_id || row.transfermarktId);
const playerIdOf = (row = {}) => text(row.tbg_player_id || row.player_id);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function eventId(payload) {
  return `pchg_${createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex").slice(0, 24)}`;
}

function projection(change) {
  switch (change.type) {
    case "rating_change":
      return { before: change.before, after: change.after, delta: change.delta };
    case "club_change":
    case "newly_unsigned":
      return { before: change.before ?? null, after: change.after ?? null };
    case "new_player":
      return {
        before: null,
        after: {
          tbg_rating: change.current?.tbg_rating ?? null,
          current_club: change.current?.current_club || change.current?.tbg_club || "Without Club",
          market_value_eur: change.current?.market_value_eur ?? null
        }
      };
    case "removed_player":
      return {
        before: {
          tbg_rating: change.previous?.tbg_rating ?? null,
          current_club: change.previous?.current_club || change.previous?.tbg_club || "Without Club",
          market_value_eur: change.previous?.market_value_eur ?? null
        },
        after: null
      };
    default:
      return { before: change.before ?? null, after: change.after ?? null };
  }
}

const args = parseArgs(process.argv.slice(2));
const ledgerPath = args.ledger || "derived/player-changes/player-change-ledger.json";
const queuePath = args.queue || "derived/player-changes/player-change-queue.json";
const batchPath = args.batch || "derived/player-changes/player-change-batch.json";
const summaryPath = args.summary || "derived/player-changes/player-change-queue-summary.json";
const masterPath = args.master || "data/transfermarkt/players-master.json";
const ratingProfilesPath = args.ratingProfiles || "calibration/tbg-rating-profiles.json";

const ledger = await readJson(ledgerPath, { summary: {}, changes: [] });
const existingQueueRaw = await readJson(queuePath, { version: "tbg-player-change-queue-v1", entries: [] });
const masterRaw = await readJson(masterPath, []);
const ratingProfilesRaw = await readJson(ratingProfilesPath, []);
const master = Array.isArray(masterRaw) ? masterRaw : masterRaw?.players || [];
const ratingProfiles = Array.isArray(ratingProfilesRaw) ? ratingProfilesRaw : ratingProfilesRaw?.players || [];
const existingEntries = Array.isArray(existingQueueRaw) ? existingQueueRaw : existingQueueRaw?.entries || [];
const existingIds = new Set(existingEntries.map((entry) => entry.event_id).filter(Boolean));
const masterByTmId = new Map(master.map((row) => [tmIdOf(row), row]).filter(([id]) => id));
const ratingsByTmId = new Map(ratingProfiles.map((row) => [tmIdOf(row), row]).filter(([id]) => id));
const detectedAt = ledger.summary?.generated_at || new Date().toISOString();
const firstEdition = Boolean(ledger.summary?.first_edition);
const appended = [];
const duplicateEventIds = [];

if (!firstEdition) {
  for (const change of ledger.changes || []) {
    const current = change.current || {};
    const previous = change.previous || {};
    const playerId = text(change.player_id || playerIdOf(current) || playerIdOf(previous));
    const tmId = text(tmIdOf(current) || tmIdOf(previous) || playerId.match(/^tbg-tm-(\d+)$/i)?.[1] || "");
    const masterRow = masterByTmId.get(tmId) || {};
    const ratingProfile = ratingsByTmId.get(tmId) || {};
    const modelVersion = text(
      ratingProfile.ability?.model_version
      || current.rating_model_version
      || current.ability_profile?.model_version
      || previous.rating_model_version
      || previous.ability_profile?.model_version
    ) || null;
    const changeProjection = projection(change);
    const identity = {
      type: change.type,
      player_id: playerId,
      transfermarkt_id: tmId,
      change: changeProjection,
      source_scraped_at: text(masterRow.scraped_at),
      rating_model_version: modelVersion
    };
    const id = eventId(identity);
    if (existingIds.has(id)) {
      duplicateEventIds.push(id);
      continue;
    }

    const event = {
      event_id: id,
      status: "pending",
      detected_at: detectedAt,
      event_type: change.type,
      player_id: playerId,
      transfermarkt_id: tmId,
      player_name: text(change.player_name || current.player_name || previous.player_name || masterRow.display_name || masterRow.full_name),
      before: changeProjection.before ?? null,
      after: changeProjection.after ?? null,
      delta: changeProjection.delta ?? null,
      provenance: {
        source: text(masterRow.source || current.source || previous.source || "transfermarkt"),
        source_scraped_at: text(masterRow.scraped_at) || null,
        market_value_determined: masterRow.market_value_determined || null,
        rating_model_version: modelVersion,
        rating_inputs: ratingProfile.ability?.explanation || null,
        player_database_edition_generated_at: ledger.summary?.generated_at || null
      },
      publication: {
        published_at: null,
        release_id: null
      }
    };
    appended.push(event);
    existingIds.add(id);
  }
}

const entries = [...existingEntries, ...appended];
const queue = {
  version: "tbg-player-change-queue-v1",
  updated_at: detectedAt,
  entries
};
const batch = {
  version: "tbg-player-change-batch-v1",
  generated_at: detectedAt,
  first_edition: firstEdition,
  detected_changes: (ledger.changes || []).length,
  appended_events: appended.length,
  duplicate_events_skipped: duplicateEventIds.length,
  event_ids: appended.map((event) => event.event_id),
  events: appended
};
const byType = entries.reduce((memo, entry) => {
  memo[entry.event_type] = (memo[entry.event_type] || 0) + 1;
  return memo;
}, {});
const byStatus = entries.reduce((memo, entry) => {
  memo[entry.status] = (memo[entry.status] || 0) + 1;
  return memo;
}, {});
const summary = {
  generated_at: detectedAt,
  queue_version: queue.version,
  total_events: entries.length,
  appended_events: appended.length,
  duplicate_events_skipped: duplicateEventIds.length,
  first_edition_baseline_only: firstEdition,
  by_status: byStatus,
  by_type: byType
};

for (const path of [queuePath, batchPath, summaryPath]) await mkdir(dirname(path), { recursive: true });
await writeFile(queuePath, JSON.stringify(queue, null, 2) + "\n", "utf8");
await writeFile(batchPath, JSON.stringify(batch, null, 2) + "\n", "utf8");
await writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(JSON.stringify(summary, null, 2));
