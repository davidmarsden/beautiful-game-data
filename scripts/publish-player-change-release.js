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

async function readJson(path, fallback) {
  if (!(await exists(path))) return fallback;
  return JSON.parse(await readFile(path, "utf8"));
}

async function readRequiredQueue(path) {
  if (!(await exists(path))) throw new Error(`Governed player-change queue is missing: ${path}`);
  let value;
  try { value = JSON.parse(await readFile(path, "utf8")); }
  catch (error) { throw new Error(`Governed player-change queue is not valid JSON: ${path}: ${error.message}`); }
  if (!value || Array.isArray(value) || typeof value !== "object" || value.version !== "tbg-player-change-queue-v1" || !Array.isArray(value.entries)) {
    throw new Error(`Governed player-change queue has an invalid structure: ${path}`);
  }
  return value;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const text = (value) => String(value ?? "").trim();
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const ELIGIBLE_TYPES = new Set(["rating_change", "new_player"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hashId(prefix, payload) {
  return `${prefix}_${createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex").slice(0, 20)}`;
}

function eventImportance(event) {
  if (event.event_type === "rating_change") return Math.abs(finite(event.delta, 0)) * 1000 + finite(event.after, 0);
  if (event.event_type === "new_player") {
    const after = event.after || {};
    return finite(after.tbg_rating, 0) * 1000 + Math.log10(Math.max(1, finite(after.market_value_eur, 0)));
  }
  return 0;
}

function eventTypeRank(event) {
  return event.event_type === "rating_change" ? 0 : 1;
}

function compareEvents(a, b) {
  const aDetected = Date.parse(a.detected_at || "") || 0;
  const bDetected = Date.parse(b.detected_at || "") || 0;
  if (aDetected !== bDetected) return aDetected - bDetected;
  const typeRank = eventTypeRank(a) - eventTypeRank(b);
  if (typeRank) return typeRank;
  const importance = eventImportance(b) - eventImportance(a);
  if (importance) return importance;
  return String(a.event_id).localeCompare(String(b.event_id));
}

function selectReleaseEvents(pending, limit) {
  const sorted = [...pending].sort(compareEvents);
  const ratings = sorted.filter((event) => event.event_type === "rating_change");
  const newPlayers = sorted.filter((event) => event.event_type === "new_player");
  if (limit < 2 || !ratings.length || !newPlayers.length) return sorted.slice(0, limit);
  const newPlayerCap = Math.min(newPlayers.length, Math.max(1, Math.floor(limit / 3)));
  const ratingCap = Math.max(1, limit - newPlayerCap);
  return [...ratings.slice(0, ratingCap), ...newPlayers.slice(0, newPlayerCap)].sort(compareEvents);
}

function pendingCounts(entries) {
  const pending = entries.filter((entry) => entry.status === "pending" && ELIGIBLE_TYPES.has(entry.event_type));
  return {
    total: pending.length,
    rating_changes: pending.filter((event) => event.event_type === "rating_change").length,
    new_players: pending.filter((event) => event.event_type === "new_player").length,
    other_updates: 0
  };
}

function managerProjection(event) {
  return {
    event_id: event.event_id,
    event_type: event.event_type,
    player_id: event.player_id,
    transfermarkt_id: event.transfermarkt_id,
    player_name: event.player_name,
    before: event.before ?? null,
    after: event.after ?? null,
    delta: event.delta ?? null,
    detected_at: event.detected_at,
    provenance: event.provenance || null
  };
}

function latestProjection(release, pending) {
  if (!release) return { version: "tbg-player-release-latest-v1", release: null, ratings_updates: [], new_players: [], other_updates: [], pending_eligible: pending.total, pending };
  const projected = release.events.map(managerProjection);
  return {
    version: "tbg-player-release-latest-v1",
    release: { release_id: release.release_id, slot: release.slot, published_at: release.published_at, event_count: release.event_count },
    ratings_updates: projected.filter((event) => event.event_type === "rating_change"),
    new_players: projected.filter((event) => event.event_type === "new_player"),
    other_updates: [],
    pending_eligible: pending.total,
    pending
  };
}

function summaryPending(pending) {
  return { pending_eligible: pending.total, pending_rating_changes: pending.rating_changes, pending_new_players: pending.new_players, pending_other_updates: 0 };
}

const args = parseArgs(process.argv.slice(2));
const queuePath = args.queue || "derived/player-changes/player-change-queue.json";
const releasesPath = args.releases || "derived/player-changes/player-release-history.json";
const latestPath = args.latest || "derived/player-changes/player-release-latest.json";
const summaryPath = args.summary || "derived/player-changes/player-release-summary.json";
const slot = text(args.slot) || new Date().toISOString().slice(0, 10);
const target = Math.max(1, Math.floor(finite(args.target, 30)));
const max = Math.max(1, Math.floor(finite(args.max, 40)));
const limit = Math.min(target, max);
const publishedAt = text(args.publishedAt) || new Date().toISOString();

if (!/^\d{4}-\d{2}-\d{2}(?:[a-z0-9._-]+)?$/i.test(slot)) throw new Error(`Invalid release slot: ${slot}`);

const queueRaw = await readRequiredQueue(queuePath);
const historyRaw = await readJson(releasesPath, { version: "tbg-player-release-history-v1", releases: [] });
const entries = queueRaw.entries;
const releases = Array.isArray(historyRaw) ? historyRaw : historyRaw.releases || [];
const existingRelease = releases.find((release) => release.slot === slot);
const latestHistoricalRelease = releases.length ? releases[releases.length - 1] : null;
const pendingEligibleBefore = entries.filter((entry) => entry.status === "pending" && ELIGIBLE_TYPES.has(entry.event_type));
const pendingBefore = pendingCounts(entries);

if (existingRelease) {
  await writeJson(latestPath, latestProjection(latestHistoricalRelease, pendingBefore));
  const summary = { generated_at: publishedAt, release_slot: slot, release_id: existingRelease.release_id, idempotent_replay: true, published_events: existingRelease.event_count, ...summaryPending(pendingBefore), total_releases: releases.length };
  await writeJson(summaryPath, summary);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const selected = selectReleaseEvents(pendingEligibleBefore, limit);
if (!selected.length) {
  await writeJson(latestPath, latestProjection(latestHistoricalRelease, pendingBefore));
  const summary = { generated_at: publishedAt, release_slot: slot, release_id: null, idempotent_replay: false, published_events: 0, ...summaryPending(pendingBefore), total_releases: releases.length };
  await writeJson(summaryPath, summary);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

const releaseId = hashId("prls", { slot, event_ids: selected.map((event) => event.event_id) });
const selectedIds = new Set(selected.map((event) => event.event_id));
const publishedEvents = selected.map((event) => ({ ...event, status: "published", publication: { published_at: publishedAt, release_id: releaseId } }));
const publishedById = new Map(publishedEvents.map((event) => [event.event_id, event]));
const nextEntries = entries.map((entry) => selectedIds.has(entry.event_id) ? publishedById.get(entry.event_id) : entry);
const release = {
  version: "tbg-player-release-v1",
  release_id: releaseId,
  slot,
  published_at: publishedAt,
  policy: { target, max, selected_limit: limit, include_state_changes: false, selection: "ratings and new players only; oldest detection first within type; mixed releases cap new players at one-third; significance within type; deterministic event-id tiebreak" },
  event_count: publishedEvents.length,
  counts: { rating_changes: publishedEvents.filter((event) => event.event_type === "rating_change").length, new_players: publishedEvents.filter((event) => event.event_type === "new_player").length, other_updates: 0 },
  event_ids: publishedEvents.map((event) => event.event_id),
  events: publishedEvents
};
const nextHistory = { version: "tbg-player-release-history-v1", updated_at: publishedAt, releases: [...releases, release] };
const nextQueue = { ...queueRaw, updated_at: publishedAt, entries: nextEntries };
const pendingAfter = pendingCounts(nextEntries);

await writeJson(queuePath, nextQueue);
await writeJson(releasesPath, nextHistory);
await writeJson(latestPath, latestProjection(release, pendingAfter));
const summary = { generated_at: publishedAt, release_slot: slot, release_id: releaseId, idempotent_replay: false, published_events: publishedEvents.length, rating_changes: release.counts.rating_changes, new_players: release.counts.new_players, other_updates: 0, ...summaryPending(pendingAfter), total_releases: nextHistory.releases.length };
await writeJson(summaryPath, summary);
console.log(JSON.stringify(summary, null, 2));
