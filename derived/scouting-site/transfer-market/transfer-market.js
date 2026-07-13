const $ = (id) => document.getElementById(id);
const num = (value) => Number(value) || 0;
const text = (value) => String(value ?? "").trim();
const playerName = (player) => text(player.display_name || player.player_name || player.full_name);
const nationality = (player) => Array.isArray(player.nationality) ? text(player.nationality[0]) : text(player.nationality);
const position = (player) => text(player.position || player.position_group);
const money = (value) => `€${(num(value) / 1e6).toFixed(num(value) >= 1e8 ? 0 : 1)}m`;
const profile = (player) => `../players/?id=${encodeURIComponent(player.tbg_player_id || player.transfermarkt_id)}`;

let players = [];
let preset = "all";
let tableSort = null;

const unsigned = (player) => player.assignment_status === "unsigned" || player.status === "without_club";
const marketScore = (player) => Math.round(
  num(player.tbg_rating) * 1.8
  - Math.log10(Math.max(1, num(player.market_value_eur))) * 8
  + (23 - Math.min(23, num(player.age))) * 1.5
  + (unsigned(player) ? 6 : 0)
);

const presets = {
  all: { title: "All Players", test: () => true },
  elite: { title: "Elite Bargains", test: (player) => num(player.tbg_rating) >= 91 && num(player.market_value_eur) < 30000000 },
  hidden: { title: "Hidden Gems", test: (player) => num(player.tbg_rating) >= 86 && num(player.market_value_eur) < 10000000 },
  young: { title: "Young Bargains", test: (player) => num(player.age) <= 21 && num(player.market_value_eur) < 5000000 },
  unsigned: { title: "Unsigned Players", test: unsigned }
};

const columns = [
  ["Player", "name", false],
  ["Age", "age", true],
  ["Position", "position", false],
  ["Club", "club", false],
  ["Nation", "nation", false],
  ["Value", "market_value_eur", true],
  ["TBG", "tbg_rating", true],
  ["Market Score", "market_score", true]
];

function valueFor(player, key) {
  if (key === "name") return playerName(player);
  if (key === "position") return position(player);
  if (key === "club") return unsigned(player) ? "Unsigned" : text(player.tbg_club || player.current_club);
  if (key === "nation") return nationality(player);
  if (key === "market_score") return marketScore(player);
  return player[key];
}

function compare(a, b, key, direction) {
  const av = valueFor(a, key);
  const bv = valueFor(b, key);
  const result = typeof av === "number" || typeof bv === "number"
    ? num(av) - num(bv)
    : text(av).localeCompare(text(bv), undefined, { sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function populatePositions() {
  const positions = [...new Set(players.map(position).filter(Boolean))].sort();
  $("positionFilter").innerHTML = '<option value="">All positions</option>' + positions.map((item) => `<option>${item}</option>`).join("");
}

function renderHeaders() {
  $("marketTable").querySelector("thead").innerHTML = `<tr>${columns.map(([label, key, numeric]) => {
    const active = tableSort?.key === key;
    const arrow = active ? (tableSort.direction === "asc" ? " ▲" : " ▼") : "";
    return `<th class="${numeric ? "numeric " : ""}sortable" data-sort-key="${key}" tabindex="0">${label}${arrow}</th>`;
  }).join("")}</tr>`;

  $("marketTable").querySelectorAll("th[data-sort-key]").forEach((header) => {
    const activate = () => {
      const key = header.dataset.sortKey;
      tableSort = tableSort?.key === key
        ? { key, direction: tableSort.direction === "asc" ? "desc" : "asc" }
        : { key, direction: ["name", "position", "club", "nation"].includes(key) ? "asc" : "desc" };
      render();
    };
    header.addEventListener("click", activate);
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") activate();
    });
  });
}

function render() {
  const query = text($("searchBox").value).toLowerCase();
  const positionFilter = $("positionFilter").value;
  const assignmentFilter = $("assignmentFilter").value;
  const ageMax = num($("ageMax").value);
  const ratingMin = num($("ratingMin").value);
  const valueMax = num($("valueMax").value) * 1e6;
  const limit = num($("rowLimit").value) || 50;
  const selectedSort = $("sortSelect").value;

  let rows = players
    .filter((player) => presets[preset].test(player))
    .filter((player) => !query || [playerName(player), text(player.current_club), nationality(player), position(player)].join(" ").toLowerCase().includes(query))
    .filter((player) => !positionFilter || position(player) === positionFilter)
    .filter((player) => !assignmentFilter || (assignmentFilter === "unsigned" ? unsigned(player) : !unsigned(player)))
    .filter((player) => !ageMax || num(player.age) <= ageMax)
    .filter((player) => !ratingMin || num(player.tbg_rating) >= ratingMin)
    .filter((player) => !valueMax || num(player.market_value_eur) <= valueMax);

  if (tableSort) {
    rows.sort((a, b) => compare(a, b, tableSort.key, tableSort.direction));
  } else {
    rows.sort((a, b) => selectedSort === "rating"
      ? num(b.tbg_rating) - num(a.tbg_rating)
      : selectedSort === "value"
        ? num(a.market_value_eur) - num(b.market_value_eur)
        : selectedSort === "age"
          ? num(a.age) - num(b.age)
          : selectedSort === "name"
            ? playerName(a).localeCompare(playerName(b))
            : marketScore(b) - marketScore(a));
  }

  const shown = rows.slice(0, limit);
  $("marketTitle").textContent = presets[preset].title;
  $("resultCount").textContent = `${shown.length} shown from ${rows.length.toLocaleString()} matches`;
  renderHeaders();
  $("marketTable").querySelector("tbody").innerHTML = shown.map((player) => `<tr><td><a href="${profile(player)}">${playerName(player)}</a></td><td>${player.age ?? "—"}</td><td>${position(player) || "—"}</td><td class="${unsigned(player) ? "unsigned" : ""}">${unsigned(player) ? "Unsigned" : text(player.tbg_club || player.current_club) || "—"}</td><td>${nationality(player) || "—"}</td><td class="numeric">${money(player.market_value_eur)}</td><td class="numeric"><span class="rating-pill">${player.tbg_rating ?? "—"}</span></td><td class="numeric"><span class="score-pill">${marketScore(player)}</span></td></tr>`).join("");
}

function clearPresetFilters() {
  for (const id of ["assignmentFilter", "ageMax", "ratingMin", "valueMax"]) $(id).value = "";
}

function applyPreset(key) {
  preset = key;
  tableSort = null;
  clearPresetFilters();
  document.querySelectorAll("[data-preset]").forEach((button) => button.classList.toggle("active", button.dataset.preset === key));
  if (key === "elite") { $("ratingMin").value = 91; $("valueMax").value = 30; }
  if (key === "hidden") { $("ratingMin").value = 86; $("valueMax").value = 10; }
  if (key === "young") { $("ageMax").value = 21; $("valueMax").value = 5; }
  if (key === "unsigned") $("assignmentFilter").value = "unsigned";
  render();
}

function reset() {
  preset = "all";
  tableSort = null;
  for (const id of ["searchBox", "positionFilter", "assignmentFilter", "ageMax", "ratingMin", "valueMax"]) $(id).value = "";
  $("sortSelect").value = "fit";
  document.querySelectorAll("[data-preset]").forEach((button) => button.classList.remove("active"));
  render();
}

async function init() {
  const data = await fetch("../scouting/player-database.json").then((response) => response.json());
  players = Array.isArray(data) ? data : data.players || [];
  $("marketCount").textContent = players.length.toLocaleString();
  $("unsignedCount").textContent = players.filter(unsigned).length.toLocaleString();
  $("eliteBargainCount").textContent = players.filter(presets.elite.test).length.toLocaleString();
  $("hiddenGemCount").textContent = players.filter(presets.hidden.test).length.toLocaleString();
  populatePositions();
  render();
}

document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.preset)));
for (const id of ["searchBox", "positionFilter", "assignmentFilter", "ageMax", "ratingMin", "valueMax", "rowLimit"]) {
  $(id).addEventListener(id === "searchBox" ? "input" : "change", render);
}
$("sortSelect").addEventListener("change", () => { tableSort = null; render(); });
$("resetButton").addEventListener("click", reset);
init().catch((error) => {
  $("resultCount").textContent = `Could not load market: ${error.message}`;
  console.error(error);
});