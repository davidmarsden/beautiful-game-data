import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

async function exists(path) { try { await access(path); return true; } catch { return false; } }
const text = (value) => String(value ?? "").trim();
const num = (value) => Number(value) || 0;
const idOf = (row) => text(row.tbg_player_id || row.transfermarkt_id || row.player_id);
const nameOf = (row) => text(row.player_name || row.display_name || row.full_name);
const clubOf = (row) => text(row.tbg_club || row.current_club);
const unsigned = (row) => row.assignment_status === "unsigned" || row.status === "without_club";

const previousPath = process.argv[2] || "derived/player-database/player-database-previous.json";
const currentPath = process.argv[3] || "derived/player-database/player-database.json";
const outputPath = "derived/player-changes/player-change-ledger.json";
const markdownPath = "derived/player-changes/player-change-ledger.md";

const currentRaw = JSON.parse(await readFile(currentPath, "utf8"));
const current = Array.isArray(currentRaw) ? currentRaw : currentRaw.players || [];
const previous = await exists(previousPath)
  ? (() => { const value = JSON.parse(require("node:fs").readFileSync(previousPath, "utf8")); return Array.isArray(value) ? value : value.players || []; })()
  : [];

const previousById = new Map(previous.map((row) => [idOf(row), row]).filter(([id]) => id));
const currentById = new Map(current.map((row) => [idOf(row), row]).filter(([id]) => id));
const changes = [];

for (const row of current) {
  const id = idOf(row);
  const before = previousById.get(id);
  if (!before) {
    changes.push({ type: "new_player", player_id: id, player_name: nameOf(row), current: row });
    continue;
  }
  if (num(before.tbg_rating) !== num(row.tbg_rating)) {
    changes.push({ type: "rating_change", player_id: id, player_name: nameOf(row), before: num(before.tbg_rating), after: num(row.tbg_rating), delta: num(row.tbg_rating) - num(before.tbg_rating), current: row });
  }
  if (clubOf(before) !== clubOf(row)) {
    changes.push({ type: "club_change", player_id: id, player_name: nameOf(row), before: clubOf(before) || "Unsigned", after: clubOf(row) || "Unsigned", current: row });
  }
  if (!unsigned(before) && unsigned(row)) {
    changes.push({ type: "newly_unsigned", player_id: id, player_name: nameOf(row), before: clubOf(before) || "Assigned", after: "Unsigned", current: row });
  }
}

for (const row of previous) {
  const id = idOf(row);
  if (!currentById.has(id)) changes.push({ type: "removed_player", player_id: id, player_name: nameOf(row), previous: row });
}

const order = { new_player: 0, rating_change: 1, club_change: 2, newly_unsigned: 3, removed_player: 4 };
changes.sort((a, b) => order[a.type] - order[b.type] || Math.abs(num(b.delta)) - Math.abs(num(a.delta)) || a.player_name.localeCompare(b.player_name));
const summary = {
  generated_at: new Date().toISOString(),
  previous_players: previous.length,
  current_players: current.length,
  first_edition: previous.length === 0,
  new_players: changes.filter((row) => row.type === "new_player").length,
  rating_increases: changes.filter((row) => row.type === "rating_change" && row.delta > 0).length,
  rating_decreases: changes.filter((row) => row.type === "rating_change" && row.delta < 0).length,
  club_changes: changes.filter((row) => row.type === "club_change").length,
  newly_unsigned: changes.filter((row) => row.type === "newly_unsigned").length,
  removed_players: changes.filter((row) => row.type === "removed_player").length
};
const report = { summary, changes };
const lines = ["# Player Change Ledger", "", `Generated: ${summary.generated_at}`, "", ...Object.entries(summary).filter(([key]) => !["generated_at", "first_edition"].includes(key)).map(([key, value]) => `- ${key.replaceAll("_", " ")}: ${value}`), "", "## Changes", ""];
for (const change of changes) {
  const detail = change.type === "rating_change" ? `${change.before} → ${change.after} (${change.delta > 0 ? "+" : ""}${change.delta})`
    : change.type === "club_change" ? `${change.before} → ${change.after}`
    : change.type === "newly_unsigned" ? `${change.before} → Unsigned`
    : change.type === "new_player" ? `added at ${clubOf(change.current) || "Unsigned"}`
    : "removed from current edition";
  lines.push(`- ${change.player_name}: ${change.type.replaceAll("_", " ")} — ${detail}`);
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", "utf8");
await writeFile(markdownPath, lines.join("\n") + "\n", "utf8");
console.log(JSON.stringify(summary, null, 2));
