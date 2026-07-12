const $ = (id) => document.getElementById(id);
const num = (value) => Number(value) || 0;
const text = (value) => String(value ?? "").trim();
const money = (value) => `€${(num(value) / 1e6).toFixed(num(value) >= 1e8 ? 0 : 1)}m`;
const avg = (rows, key) => rows.length ? rows.reduce((sum, row) => sum + num(row[key]), 0) / rows.length : 0;
const playerName = (player) => text(player.display_name || player.player_name || player.full_name);
const nation = (player) => Array.isArray(player.nationality) ? text(player.nationality[0]) : text(player.nationality);
const profile = (player) => `../players/?id=${encodeURIComponent(player.tbg_player_id || player.transfermarkt_id)}`;

let players = [];
let universe = [];
let clubById = new Map();
let clubByName = new Map();
let currentRows = [];
let currentDesk = "players";
let sortState = { key: null, direction: "desc" };

const configs = {
  players: {
    highest_rated: { label: "Highest Rated Players", sortKey: "tbg_rating", direction: "desc", filter: () => true },
    highest_value: { label: "Highest Value Players", sortKey: "market_value_eur", direction: "desc", filter: () => true },
    youngest_elite: { label: "Youngest Elite Players", sortKey: "age", direction: "asc", filter: (player) => num(player.tbg_rating) >= 90 },
    oldest: { label: "Oldest Players", sortKey: "age", direction: "desc", filter: () => true },
    u21_value: { label: "Most Valuable U21 Players", sortKey: "market_value_eur", direction: "desc", filter: (player) => num(player.age) <= 21 },
    free_agents: { label: "Most Valuable Free Agents", sortKey: "market_value_eur", direction: "desc", filter: (player) => player.assignment_status === "unsigned" || player.status === "without_club" },
    goalkeepers: { label: "Best Goalkeepers", sortKey: "tbg_rating", direction: "desc", filter: (player) => text(player.position_group) === "GK" },
    defenders: { label: "Best Defenders", sortKey: "tbg_rating", direction: "desc", filter: (player) => text(player.position_group) === "DEF" },
    midfielders: { label: "Best Midfielders", sortKey: "tbg_rating", direction: "desc", filter: (player) => text(player.position_group) === "MID" },
    attackers: { label: "Best Attackers", sortKey: "tbg_rating", direction: "desc", filter: (player) => text(player.position_group) === "ATT" }
  },
  clubs: {
    strongest: { label: "Strongest Clubs", sortKey: "top_xi", direction: "desc" },
    valuable: { label: "Most Valuable Clubs", sortKey: "total_value", direction: "desc" },
    youngest: { label: "Youngest Clubs", sortKey: "average_age", direction: "asc" },
    oldest: { label: "Oldest Clubs", sortKey: "average_age", direction: "desc" },
    biggest: { label: "Biggest Squads", sortKey: "players", direction: "desc" }
  },
  nations: {
    rating: { label: "Highest Average Rating by Nation", sortKey: "average_rating", direction: "desc" },
    value: { label: "Most Valuable Nations", sortKey: "total_value", direction: "desc" },
    elite: { label: "Most Elite Players by Nation", sortKey: "elite", direction: "desc" },
    wonderkids: { label: "Most Wonderkids by Nation", sortKey: "wonderkids", direction: "desc" }
  },
  leagues: {
    rating: { label: "Strongest Leagues", sortKey: "average_rating", direction: "desc" },
    value: { label: "Richest Leagues", sortKey: "total_value", direction: "desc" },
    youngest: { label: "Youngest Leagues", sortKey: "average_age", direction: "asc" },
    elite: { label: "Most Elite Players by League", sortKey: "elite", direction: "desc" }
  }
};

function clubMeta(player) {
  const id = text(player.current_club_id || player.transfermarkt_club_id || player.club_id);
  if (id && clubById.has(id)) return clubById.get(id);
  return clubByName.get(text(player.current_club).toLowerCase()) || null;
}

function leagueName(player) {
  const direct = text(
    player.current_competition_name ||
    player.competition_name ||
    player.league_name ||
    player.current_league ||
    player.league
  );
  if (direct) return direct;
  const club = clubMeta(player);
  return text(club?.league || club?.competition_name || club?.competition) || "Unknown";
}

function groupRows(keyFn, label) {
  const groups = new Map();
  for (const player of players) {
    const key = keyFn(player);
    if (!key || key === "Unknown") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(player);
  }
  return [...groups].map(([name, rows]) => ({
    name,
    group_type: label,
    players: rows.length,
    average_rating: avg(rows, "tbg_rating"),
    average_age: avg(rows, "age"),
    total_value: rows.reduce((sum, player) => sum + num(player.market_value_eur), 0),
    elite: rows.filter((player) => num(player.tbg_rating) >= 90).length,
    wonderkids: rows.filter((player) => num(player.age) <= 21 && num(player.tbg_rating) >= 87).length,
    player_rows: rows
  }));
}

function clubRows() {
  return groupRows((player) => text(player.current_club), "club").map((row) => {
    const sorted = [...row.player_rows].sort((a, b) => num(b.tbg_rating) - num(a.tbg_rating));
    return { ...row, top_xi: avg(sorted.slice(0, 11), "tbg_rating") };
  });
}

function compareValues(a, b, key, direction) {
  const av = a[key];
  const bv = b[key];
  let result;
  if (typeof av === "number" || typeof bv === "number") result = num(av) - num(bv);
  else result = text(av).localeCompare(text(bv), undefined, { sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function options() {
  const desk = $("deskSelect").value;
  $("rankingSelect").innerHTML = Object.entries(configs[desk])
    .map(([value, config]) => `<option value="${value}">${config.label}</option>`)
    .join("");
  $("minimumPlayersLabel").hidden = !["nations", "leagues"].includes(desk);
}

function sourceRows(desk, config) {
  if (desk === "players") return players.filter(config.filter);
  if (desk === "clubs") return clubRows();
  if (desk === "nations") return groupRows(nation, "nation");
  return groupRows(leagueName, "league");
}

function render() {
  currentDesk = $("deskSelect").value;
  const rankingKey = $("rankingSelect").value;
  const config = configs[currentDesk][rankingKey];
  const query = text($("searchBox").value).toLowerCase();
  const limit = num($("rowLimit").value) || 50;
  const minimumPlayers = num($("minimumPlayers").value) || 1;

  if (!sortState.key) {
    sortState = { key: config.sortKey, direction: config.direction };
  }

  let rows = sourceRows(currentDesk, config);
  if (["nations", "leagues"].includes(currentDesk)) rows = rows.filter((row) => row.players >= minimumPlayers);
  rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query));
  rows.sort((a, b) => compareValues(a, b, sortState.key, sortState.direction));
  currentRows = rows.slice(0, limit);

  $("rankingTitle").textContent = config.label;
  $("resultCount").textContent = `${currentRows.length} shown`;
  if (currentDesk === "players") renderPlayers(currentRows, $("rankingTable"));
  else renderGroups(currentRows);
}

function sortableHeader(label, key, numeric = false) {
  const active = sortState.key === key;
  const arrow = active ? (sortState.direction === "asc" ? " ▲" : " ▼") : "";
  return `<th data-sort-key="${key}" class="${numeric ? "numeric " : ""}sortable" tabindex="0">${label}${arrow}</th>`;
}

function bindSorting(table) {
  table.querySelectorAll("th[data-sort-key]").forEach((header) => {
    const activate = () => {
      const key = header.dataset.sortKey;
      sortState = sortState.key === key
        ? { key, direction: sortState.direction === "asc" ? "desc" : "asc" }
        : { key, direction: ["name", "player_name", "current_club", "nationality", "position"].includes(key) ? "asc" : "desc" };
      render();
    };
    header.addEventListener("click", activate);
    header.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") activate(); });
  });
}

function renderPlayers(rows, table) {
  table.querySelector("thead").innerHTML = `<tr><th>#</th>${sortableHeader("Player", "player_name")}${sortableHeader("Age", "age")}${sortableHeader("Position", "position")}${sortableHeader("Club", "current_club")}${sortableHeader("Nation", "nationality")}${sortableHeader("Value", "market_value_eur", true)}${sortableHeader("TBG", "tbg_rating", true)}</tr>`;
  table.querySelector("tbody").innerHTML = rows.map((player, index) => `<tr><td class="rank">${index + 1}</td><td><a href="${profile(player)}">${playerName(player)}</a></td><td>${player.age ?? "—"}</td><td>${text(player.position) || text(player.position_group) || "—"}</td><td>${text(player.current_club) || "Unsigned"}</td><td>${nation(player) || "—"}</td><td class="numeric">${money(player.market_value_eur)}</td><td class="numeric"><span class="rating-pill">${player.tbg_rating ?? "—"}</span></td></tr>`).join("");
  bindSorting(table);
}

function renderGroups(rows) {
  const table = $("rankingTable");
  table.querySelector("thead").innerHTML = `<tr><th>#</th>${sortableHeader("Name", "name")}${sortableHeader("Players", "players", true)}${sortableHeader("Avg TBG", currentDesk === "clubs" ? "top_xi" : "average_rating", true)}${sortableHeader("Avg Age", "average_age", true)}${sortableHeader("Elite 90+", "elite", true)}${sortableHeader("U21 87+", "wonderkids", true)}${sortableHeader("Total Value", "total_value", true)}</tr>`;
  table.querySelector("tbody").innerHTML = rows.map((row, index) => `<tr><td class="rank">${index + 1}</td><td><button class="group-link" type="button" data-group-index="${index}">${row.name}</button></td><td class="numeric">${row.players}</td><td class="numeric">${row.top_xi ? `${row.top_xi.toFixed(1)} XI` : row.average_rating.toFixed(1)}</td><td class="numeric">${row.average_age.toFixed(1)}</td><td class="numeric">${row.elite}</td><td class="numeric">${row.wonderkids}</td><td class="numeric">${money(row.total_value)}</td></tr>`).join("");
  bindSorting(table);
  table.querySelectorAll("button[data-group-index]").forEach((button) => {
    button.addEventListener("click", () => openDrilldown(rows[num(button.dataset.groupIndex)]));
  });
}

function openDrilldown(group) {
  if (!group) return;
  const panel = $("drilldownPanel");
  $("drilldownTitle").textContent = `${group.name} players`;
  $("drilldownSummary").textContent = `${group.players} players • average TBG ${group.average_rating.toFixed(1)} • total value ${money(group.total_value)}`;
  const rows = [...group.player_rows].sort((a, b) => num(b.tbg_rating) - num(a.tbg_rating) || num(b.market_value_eur) - num(a.market_value_eur));
  renderPlayers(rows, $("drilldownTable"));
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function init() {
  const [playerData, universeData] = await Promise.all([
    fetch("../scouting/player-database.json").then((response) => response.json()),
    fetch("../clubs/club-universe.json").then((response) => response.json()).catch(() => ({ clubs: [] }))
  ]);
  players = Array.isArray(playerData) ? playerData : playerData.players || [];
  universe = universeData.clubs || [];
  clubById = new Map(universe.map((club) => [text(club.transfermarkt_club_id || club.club_id), club]));
  clubByName = new Map(universe.map((club) => [text(club.name || club.club_name).toLowerCase(), club]));

  $("playerCount").textContent = players.length.toLocaleString();
  const topPlayer = [...players].sort((a, b) => num(b.tbg_rating) - num(a.tbg_rating))[0];
  $("topPlayer").textContent = topPlayer ? `${playerName(topPlayer)} ${topPlayer.tbg_rating}` : "—";
  const clubs = clubRows().sort((a, b) => b.top_xi - a.top_xi);
  $("topClub").textContent = clubs[0]?.name || "—";
  const nations = groupRows(nation, "nation").sort((a, b) => b.total_value - a.total_value);
  $("topNation").textContent = nations[0]?.name || "—";
  options();
  render();
}

$("deskSelect").addEventListener("change", () => {
  sortState = { key: null, direction: "desc" };
  options();
  render();
});
$("rankingSelect").addEventListener("change", () => { sortState = { key: null, direction: "desc" }; render(); });
$("minimumPlayers").addEventListener("change", render);
$("rowLimit").addEventListener("change", render);
$("searchBox").addEventListener("input", render);
$("closeDrilldown").addEventListener("click", () => { $("drilldownPanel").hidden = true; });

init().catch((error) => {
  $("resultCount").textContent = `Could not load rankings: ${error.message}`;
  console.error(error);
});
