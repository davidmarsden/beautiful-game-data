const $ = (id) => document.getElementById(id);
const text = (value) => String(value ?? "").trim();
const num = (value) => Number(value) || 0;
const profile = (change) => `../players/?id=${encodeURIComponent(change.player_id)}`;
const labels = { new_player: "New player", rating_change: "Rating change", club_change: "Club change", newly_unsigned: "Newly unsigned", removed_player: "Removed" };
let report = { summary: {}, changes: [] };

function currentPlayer(change) { return change.current || change.previous || {}; }
function detail(change, side) {
  if (change.type === "rating_change") return String(side === "before" ? change.before : change.after);
  if (["club_change", "newly_unsigned"].includes(change.type)) return text(side === "before" ? change.before : change.after) || "—";
  if (change.type === "new_player") return side === "before" ? "Not listed" : "Added";
  return side === "before" ? "Listed" : "Removed";
}
function club(change) {
  const player = currentPlayer(change);
  return text(player.tbg_club || player.current_club) || (player.assignment_status === "unsigned" ? "Unsigned" : "—");
}
function render() {
  const type = $("typeFilter").value;
  const direction = $("directionFilter").value;
  const query = text($("searchBox").value).toLowerCase();
  const limit = num($("rowLimit").value) || 50;
  let rows = report.changes.filter((change) => !type || change.type === type);
  if (direction === "up") rows = rows.filter((change) => change.type === "rating_change" && num(change.delta) > 0);
  if (direction === "down") rows = rows.filter((change) => change.type === "rating_change" && num(change.delta) < 0);
  rows = rows.filter((change) => !query || JSON.stringify(change).toLowerCase().includes(query));
  const shown = rows.slice(0, limit);
  $("resultCount").textContent = `${shown.length} shown from ${rows.length.toLocaleString()} changes`;
  $("changeTable").querySelector("tbody").innerHTML = shown.map((change) => {
    const linked = change.type !== "removed_player";
    const playerCell = linked ? `<a href="${profile(change)}">${change.player_name}</a>` : change.player_name;
    const delta = change.type === "rating_change" ? `${change.delta > 0 ? "+" : ""}${change.delta}` : "—";
    return `<tr><td>${playerCell}</td><td><span class="change-pill">${labels[change.type] || change.type}</span></td><td>${detail(change, "before")}</td><td>${detail(change, "after")}</td><td class="numeric ${num(change.delta) > 0 ? "delta-up" : num(change.delta) < 0 ? "delta-down" : ""}">${delta}</td><td>${club(change)}</td></tr>`;
  }).join("") || '<tr><td colspan="6" class="muted">No changes match these filters.</td></tr>';
}

async function init() {
  report = await fetch("./player-change-ledger.json").then((response) => response.json());
  const summary = report.summary || {};
  $("newCount").textContent = num(summary.new_players).toLocaleString();
  $("riseCount").textContent = num(summary.rating_increases).toLocaleString();
  $("fallCount").textContent = num(summary.rating_decreases).toLocaleString();
  $("transferCount").textContent = num(summary.club_changes).toLocaleString();
  if (summary.first_edition) $("ledgerTitle").textContent = "Baseline Edition";
  render();
}

for (const id of ["typeFilter", "directionFilter", "rowLimit"]) $(id).addEventListener("change", render);
$("searchBox").addEventListener("input", render);
init().catch((error) => { $("resultCount").textContent = `Could not load changes: ${error.message}`; console.error(error); });
