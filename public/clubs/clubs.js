const DATA_URLS = [
  "../scouting/player-database.json",
  "../derived/player-database/player-database.json",
  "/beautiful-game-data/scouting/player-database.json"
];

const state = {
  players: [],
  clubs: [],
  filtered: [],
  selectedClubId: null,
  sort: "average_rating:desc"
};

const $ = (id) => document.getElementById(id);

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value, digits = 1) {
  return num(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function money(value) {
  const n = num(value);
  if (n >= 1_000_000_000) return `€${(n / 1_000_000_000).toFixed(2)}bn`;
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `€${Math.round(n / 1000)}k`;
  return "—";
}

function average(values) {
  const clean = values.map(num).filter(Boolean);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

async function loadPlayers() {
  let lastError;
  for (const url of DATA_URLS) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Player database is not an array");
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Unable to load player database");
}

function aggregateClubs(players) {
  const map = new Map();
  for (const player of players) {
    const clubName = player.current_club || player.tbg_club || "Without Club";
    if (!clubName || clubName === "Without Club") continue;
    const clubId = player.current_club_id || clubName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!map.has(clubId)) {
      map.set(clubId, {
        club_id: clubId,
        club_name: clubName,
        players: [],
        continent: player.continent || "",
        league: player.league || ""
      });
    }
    map.get(clubId).players.push(player);
  }

  return [...map.values()].map((club) => {
    const squad = club.players.sort((a, b) => num(b.tbg_rating) - num(a.tbg_rating) || num(b.market_value_eur) - num(a.market_value_eur));
    const top25 = squad.slice(0, 25);
    const best = squad[0];
    const youngest = squad.filter((p) => num(p.age)).sort((a, b) => num(a.age) - num(b.age))[0];
    const oldest = squad.filter((p) => num(p.age)).sort((a, b) => num(b.age) - num(a.age))[0];
    const depth = squad.reduce((memo, player) => {
      const group = player.position_group || "UNK";
      memo[group] = (memo[group] || 0) + 1;
      return memo;
    }, {});
    return {
      ...club,
      squad,
      squad_size: squad.length,
      average_rating: average(top25.map((p) => p.tbg_rating)),
      average_age: average(top25.map((p) => p.age)),
      total_value: squad.reduce((sum, p) => sum + num(p.market_value_eur), 0),
      best_player: best,
      youngest_player: youngest,
      oldest_player: oldest,
      depth
    };
  }).sort((a, b) => b.average_rating - a.average_rating || b.total_value - a.total_value || a.club_name.localeCompare(b.club_name));
}

function setSummary() {
  const strongest = [...state.clubs].sort((a, b) => b.average_rating - a.average_rating)[0];
  const richest = [...state.clubs].sort((a, b) => b.total_value - a.total_value)[0];
  const youngest = [...state.clubs].filter((c) => c.average_age).sort((a, b) => a.average_age - b.average_age)[0];
  $("clubCount").textContent = state.clubs.length.toLocaleString();
  $("strongestClub").textContent = strongest ? strongest.club_name : "—";
  $("richestClub").textContent = richest ? richest.club_name : "—";
  $("youngestClub").textContent = youngest ? youngest.club_name : "—";
}

function matchesSearch(club, query) {
  if (!query) return true;
  const haystack = [
    club.club_name,
    club.league,
    club.continent,
    ...club.squad.slice(0, 30).map((p) => p.player_name)
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function applyFilters() {
  const query = $("clubSearch").value.trim();
  const ratingMin = num($("ratingMin").value);
  const valueMin = num($("valueMin").value) * 1_000_000;
  const [key, direction] = state.sort.split(":");
  const sign = direction === "asc" ? 1 : -1;

  state.filtered = state.clubs
    .filter((club) => matchesSearch(club, query))
    .filter((club) => !ratingMin || club.average_rating >= ratingMin)
    .filter((club) => !valueMin || club.total_value >= valueMin)
    .sort((a, b) => {
      const av = typeof a[key] === "string" ? a[key] : num(a[key]);
      const bv = typeof b[key] === "string" ? b[key] : num(b[key]);
      if (typeof av === "string") return av.localeCompare(bv) * sign;
      return (av - bv) * sign;
    });

  if (!state.filtered.some((club) => club.club_id === state.selectedClubId)) {
    state.selectedClubId = state.filtered[0]?.club_id || null;
  }
  renderList();
  renderProfile();
}

function renderList() {
  const list = $("clubList");
  $("resultCount").textContent = `${state.filtered.length.toLocaleString()} clubs found`;
  if (!state.filtered.length) {
    list.innerHTML = "<p>No clubs found.</p>";
    return;
  }
  list.innerHTML = state.filtered.slice(0, 120).map((club, index) => `
    <button class="club-row ${club.club_id === state.selectedClubId ? "active" : ""}" data-club-id="${club.club_id}">
      <span class="rank">${index + 1}</span>
      <span>
        <span class="club-name">${club.club_name}</span><br />
        <span class="club-meta">${club.squad_size} players • ${club.best_player?.player_name || "No star filed"}</span>
      </span>
      <span class="stat-pill">${club.average_rating.toFixed(2)}</span>
      <span class="stat-pill hide-mobile">${money(club.total_value)}</span>
      <span class="stat-pill hide-mobile">${club.average_age ? club.average_age.toFixed(1) : "—"}</span>
    </button>
  `).join("");

  list.querySelectorAll(".club-row").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedClubId = button.dataset.clubId;
      renderList();
      renderProfile();
    });
  });
}

function renderProfile() {
  const club = state.clubs.find((item) => item.club_id === state.selectedClubId);
  const panel = $("clubProfile");
  if (!club) {
    panel.innerHTML = `<span class="label">Club Profile</span><h2>Select a club</h2><p>Pick a club from the ledger.</p>`;
    return;
  }
  const depth = ["GK", "DEF", "MID", "ATT"].map((group) => `
    <div class="depth-card"><span>${group}</span><strong>${club.depth[group] || 0}</strong></div>
  `).join("");
  const squadRows = club.squad.slice(0, 30).map((player) => `
    <tr>
      <td>${player.player_name}</td>
      <td>${player.age || "—"}</td>
      <td>${player.position_group || player.position || "—"}</td>
      <td class="numeric">${money(player.market_value_eur)}</td>
      <td class="numeric"><strong>${num(player.tbg_rating).toFixed(0)}</strong></td>
    </tr>
  `).join("");

  panel.innerHTML = `
    <span class="label">Club Profile</span>
    <h2>${club.club_name}</h2>
    <p>${club.squad_size} players filed. Star man: <strong>${club.best_player?.player_name || "—"}</strong>.</p>
    <div class="profile-grid">
      <div class="profile-stat"><span>Avg rating</span><strong>${club.average_rating.toFixed(2)}</strong></div>
      <div class="profile-stat"><span>Squad value</span><strong>${money(club.total_value)}</strong></div>
      <div class="profile-stat"><span>Avg age</span><strong>${club.average_age ? club.average_age.toFixed(1) : "—"}</strong></div>
      <div class="profile-stat"><span>Best player</span><strong>${club.best_player ? num(club.best_player.tbg_rating).toFixed(0) : "—"}</strong></div>
    </div>
    <div class="depth-grid">${depth}</div>
    <p><strong>Youngest:</strong> ${club.youngest_player?.player_name || "—"} ${club.youngest_player?.age ? `(${club.youngest_player.age})` : ""}<br />
    <strong>Oldest:</strong> ${club.oldest_player?.player_name || "—"} ${club.oldest_player?.age ? `(${club.oldest_player.age})` : ""}</p>
    <table class="squad-table">
      <thead><tr><th>Player</th><th>Age</th><th>Pos</th><th class="numeric">Value</th><th class="numeric">TBG</th></tr></thead>
      <tbody>${squadRows}</tbody>
    </table>
  `;
}

function bindControls() {
  ["clubSearch", "ratingMin", "valueMin"].forEach((id) => $(id).addEventListener("input", applyFilters));
  $("sortSelect").addEventListener("change", (event) => {
    state.sort = event.target.value;
    applyFilters();
  });
  $("resetButton").addEventListener("click", () => {
    $("clubSearch").value = "";
    $("ratingMin").value = "";
    $("valueMin").value = "";
    $("sortSelect").value = "average_rating:desc";
    state.sort = "average_rating:desc";
    applyFilters();
  });
}

async function init() {
  try {
    state.players = await loadPlayers();
    state.clubs = aggregateClubs(state.players);
    setSummary();
    bindControls();
    applyFilters();
  } catch (error) {
    console.error(error);
    $("clubList").innerHTML = `<p>Could not load club database: ${error.message}</p>`;
  }
}

init();
