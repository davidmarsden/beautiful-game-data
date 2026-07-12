const PLAYER_URLS = [
  "../scouting/player-database.json",
  "/beautiful-game-data/scouting/player-database.json"
];
const UNIVERSE_URLS = ["./club-universe.json", "/beautiful-game-data/clubs/club-universe.json"];
const MIN_PLAYABLE_SQUAD = 18;
const MIN_PARTIAL_SQUAD = 5;
const TOP_WORLD_CLUBS = 80;

const state = { clubs: [], filtered: [], selectedClubId: null, sort: "weighted_strength:desc" };
const $ = (id) => document.getElementById(id);
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value) => String(value ?? "").trim();
const normaliseSearch = (value) => text(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

function money(value) {
  const n = num(value);
  if (n >= 1e9) return `€${(n / 1e9).toFixed(2)}bn`;
  if (n >= 1e6) return `€${(n / 1e6).toFixed(1)}m`;
  if (n >= 1e3) return `€${Math.round(n / 1e3)}k`;
  return "—";
}

function average(values) {
  const clean = values.map(num).filter(Boolean);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

function playerPosition(player) {
  return text(player.position || player.primary_position || player.detailed_position || player.position_group) || "—";
}

function positionGroup(player) {
  const raw = `${player.position_group || ""} ${playerPosition(player)}`.toUpperCase();
  if (/KEEPER|GOALKEEPER|\bGK\b/.test(raw)) return "GK";
  if (/BACK|DEFENDER|CENTRE-BACK|CENTER-BACK|LEFT-BACK|RIGHT-BACK|\bCB\b|\bLB\b|\bRB\b|\bDEF\b/.test(raw)) return "DEF";
  if (/MIDFIELD|MIDFIELDER|\bDM\b|\bCM\b|\bAM\b|\bMID\b/.test(raw)) return "MID";
  if (/WINGER|FORWARD|STRIKER|SECOND STRIKER|\bCF\b|\bST\b|\bATT\b/.test(raw)) return "ATT";
  return text(player.position_group).toUpperCase() || "UNK";
}

function weightedStrength(squad) {
  const weights = [1,1,1,1,1,1,1,1,1,1,1,.92,.88,.84,.8,.76,.72,.68,.62,.56,.5,.44,.38,.32,.26];
  const selected = squad.slice(0, weights.length);
  const total = selected.reduce((sum, _player, index) => sum + weights[index], 0);
  return total ? selected.reduce((sum, player, index) => sum + num(player.tbg_rating) * weights[index], 0) / total : 0;
}

function selectStartingXI(squad) {
  const pools = { GK: [], DEF: [], MID: [], ATT: [] };
  squad.forEach((player) => (pools[positionGroup(player)] || pools.MID).push(player));
  Object.values(pools).forEach((pool) => pool.sort((a, b) => num(b.tbg_rating) - num(a.tbg_rating)));
  const shapes = [
    { name: "4-3-3", need: { GK: 1, DEF: 4, MID: 3, ATT: 3 } },
    { name: "4-2-3-1", need: { GK: 1, DEF: 4, MID: 5, ATT: 1 } },
    { name: "3-4-3", need: { GK: 1, DEF: 3, MID: 4, ATT: 3 } },
    { name: "3-5-2", need: { GK: 1, DEF: 3, MID: 5, ATT: 2 } },
    { name: "4-4-2", need: { GK: 1, DEF: 4, MID: 4, ATT: 2 } }
  ];
  const viable = shapes.filter((shape) => Object.entries(shape.need).every(([group, count]) => pools[group].length >= count));
  const shape = viable[0] || shapes[0];
  const xi = [];
  for (const [group, count] of Object.entries(shape.need)) xi.push(...pools[group].slice(0, count));
  if (xi.length < 11) {
    const used = new Set(xi);
    xi.push(...squad.filter((player) => !used.has(player)).slice(0, 11 - xi.length));
  }
  return { formation: shape.name, players: xi.slice(0, 11), rating: average(xi.slice(0, 11).map((p) => p.tbg_rating)) };
}

function countryFlag(country) {
  const codes = { England:"GB", Scotland:"GB", Wales:"GB", "Northern Ireland":"GB", Spain:"ES", Germany:"DE", France:"FR", Italy:"IT", Turkey:"TR", Belgium:"BE", Netherlands:"NL", Portugal:"PT", Ukraine:"UA", Denmark:"DK", Austria:"AT", Greece:"GR", Russia:"RU", Brazil:"BR", Argentina:"AR", Uruguay:"UY", Mexico:"MX", USA:"US", Canada:"CA", "Saudi Arabia":"SA", Qatar:"QA", Japan:"JP", "South Korea":"KR", China:"CN", Egypt:"EG", Morocco:"MA", Tunisia:"TN", "South Africa":"ZA", Australia:"AU", Monaco:"MC" };
  const code = codes[country];
  return code ? [...code].map((char) => String.fromCodePoint(127397 + char.charCodeAt())).join("") : "🌍";
}

function badgeUrl(club) {
  return club.transfermarkt_club_id ? `https://tmssl.akamaized.net/images/wappen/head/${club.transfermarkt_club_id}.png` : "";
}

async function loadJson(urls) {
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Unable to load data");
}

function aggregateClubs(players, universe) {
  const universeById = new Map((universe.clubs || []).map((club) => [String(club.transfermarkt_club_id), club]));
  const universeByName = new Map();
  for (const club of universe.clubs || []) {
    for (const value of [club.name, ...(club.aliases || [])]) {
      const key = normaliseSearch(value);
      if (key) universeByName.set(key, club);
    }
  }
  const map = new Map();
  for (const player of players) {
    const clubName = text(player.current_club || player.tbg_club || "Without Club");
    if (!clubName || clubName === "Without Club") continue;
    const tmId = text(player.current_club_id || player.transfermarkt_club_id || player.club_id);
    const meta = universeById.get(tmId) || universeByName.get(normaliseSearch(clubName)) || null;
    const clubId = text(meta?.transfermarkt_club_id || tmId || normaliseSearch(clubName).replace(/\s+/g, "-"));
    if (!map.has(clubId)) map.set(clubId, { club_id: clubId, club_name: meta?.name || clubName, players: [], meta });
    map.get(clubId).players.push(player);
  }

  const clubs = [...map.values()].map((club) => {
    const squad = club.players.sort((a, b) => num(b.tbg_rating) - num(a.tbg_rating) || num(b.market_value_eur) - num(a.market_value_eur));
    const xi = selectStartingXI(squad);
    const depth = squad.reduce((memo, player) => { const group = positionGroup(player); memo[group] = (memo[group] || 0) + 1; return memo; }, {});
    const squadSize = squad.length;
    return {
      ...club,
      transfermarkt_club_id: club.meta?.transfermarkt_club_id || club.club_id,
      universe_slot: num(club.meta?.slot) || null,
      country: club.meta?.country || text(squad[0]?.country),
      continent: club.meta?.continent || text(squad[0]?.continent),
      league: club.meta?.league || text(squad[0]?.league),
      squad,
      squad_size: squadSize,
      weighted_strength: squadSize >= MIN_PLAYABLE_SQUAD ? weightedStrength(squad) : 0,
      raw_strength: weightedStrength(squad),
      average_age: average(squad.slice(0, 25).map((p) => p.age)),
      total_value: squad.reduce((sum, p) => sum + num(p.market_value_eur), 0),
      starting_xi: xi.players,
      starting_xi_rating: xi.rating,
      formation: xi.formation,
      best_player: squad[0],
      youngest_player: [...squad].filter((p) => num(p.age)).sort((a,b) => num(a.age)-num(b.age))[0],
      oldest_player: [...squad].filter((p) => num(p.age)).sort((a,b) => num(b.age)-num(a.age))[0],
      depth,
      squad_status: squadSize >= MIN_PLAYABLE_SQUAD ? "playable" : squadSize >= MIN_PARTIAL_SQUAD ? "partial" : "ringer"
    };
  });

  const top80 = clubs.filter((club) => club.universe_slot && club.universe_slot <= TOP_WORLD_CLUBS && club.squad_size >= MIN_PLAYABLE_SQUAD)
    .sort((a,b) => b.weighted_strength - a.weighted_strength);
  top80.forEach((club, index) => { club.division = `D${Math.floor(index / 20) + 1}`; club.world_rank = index + 1; });
  return clubs.sort((a,b) => (a.world_rank || 9999) - (b.world_rank || 9999) || b.weighted_strength - a.weighted_strength || a.club_name.localeCompare(b.club_name));
}

function fillSelect(id, values) {
  const select = $(id);
  const first = select.options[0].outerHTML;
  select.innerHTML = first + [...new Set(values.filter(Boolean))].sort().map((v) => `<option>${v}</option>`).join("");
}

function setSummary() {
  const clubs = state.clubs.filter((c) => c.universe_slot && c.universe_slot <= TOP_WORLD_CLUBS && c.squad_size >= MIN_PLAYABLE_SQUAD);
  $("clubCount").textContent = clubs.length.toLocaleString();
  $("strongestClub").textContent = [...clubs].sort((a,b) => b.weighted_strength-a.weighted_strength)[0]?.club_name || "—";
  $("richestClub").textContent = [...clubs].sort((a,b) => b.total_value-a.total_value)[0]?.club_name || "—";
  $("youngestClub").textContent = [...clubs].sort((a,b) => a.average_age-b.average_age)[0]?.club_name || "—";
}

function passesView(club) {
  const view = $("squadView").value;
  if (view === "top80") return club.universe_slot && club.universe_slot <= TOP_WORLD_CLUBS && club.squad_size >= MIN_PLAYABLE_SQUAD;
  if (view === "playable") return club.squad_size >= MIN_PLAYABLE_SQUAD;
  if (view === "partial") return club.squad_size >= MIN_PARTIAL_SQUAD;
  return true;
}

function applyFilters() {
  const query = normaliseSearch($("clubSearch").value);
  const division = $("divisionFilter").value;
  const continent = $("continentFilter").value;
  const country = $("countryFilter").value;
  const league = $("leagueFilter").value;
  const ratingMin = num($("ratingMin").value);
  const valueMin = num($("valueMin").value) * 1e6;
  const [key, direction] = state.sort.split(":");
  const sign = direction === "asc" ? 1 : -1;
  state.filtered = state.clubs.filter(passesView).filter((club) => {
    const playerNames = club.squad.flatMap((player) => [player.player_name, player.display_name, player.name]);
    const haystack = normaliseSearch([
      club.club_name,
      club.meta?.name,
      ...(club.meta?.aliases || []),
      club.league,
      club.country,
      club.continent,
      club.division,
      ...playerNames
    ].join(" "));
    return (!query || haystack.includes(query)) && (!division || club.division === division) && (!continent || club.continent === continent) && (!country || club.country === country) && (!league || club.league === league) && (!ratingMin || club.weighted_strength >= ratingMin) && (!valueMin || club.total_value >= valueMin);
  }).sort((a,b) => {
    const av = typeof a[key] === "string" ? a[key] : num(a[key]);
    const bv = typeof b[key] === "string" ? b[key] : num(b[key]);
    return typeof av === "string" ? av.localeCompare(bv) * sign : (av - bv) * sign;
  });
  if (!state.filtered.some((club) => club.club_id === state.selectedClubId)) state.selectedClubId = state.filtered[0]?.club_id || null;
  renderList(); renderProfile();
}

function renderList() {
  $("resultCount").textContent = `${state.filtered.length} clubs found`;
  $("clubList").innerHTML = state.filtered.map((club, index) => `
    <button class="club-row ${club.club_id === state.selectedClubId ? "active" : ""}" data-club-id="${club.club_id}">
      <span class="rank">${club.world_rank || index + 1}</span>
      <span class="club-identity"><img class="mini-badge" src="${badgeUrl(club)}" alt="" onerror="this.style.display='none'"/><span><span class="club-name">${club.club_name}</span><br/><span class="club-meta">${countryFlag(club.country)} ${club.country || "Unknown"} • ${club.league || "Unknown"} • ${club.division || "—"}</span></span></span>
      <span class="stat-pill">${club.squad_size >= MIN_PLAYABLE_SQUAD ? club.weighted_strength.toFixed(2) : `${club.raw_strength.toFixed(2)}*`}</span>
      <span class="stat-pill hide-mobile">${money(club.total_value)}</span>
      <span class="stat-pill hide-mobile">XI ${club.starting_xi_rating.toFixed(1)}</span>
    </button>`).join("") || "<p>No clubs found.</p>";
  document.querySelectorAll(".club-row").forEach((button) => button.addEventListener("click", () => { state.selectedClubId = button.dataset.clubId; renderList(); renderProfile(); if (matchMedia("(max-width:980px)").matches) $("clubProfile").scrollIntoView({behavior:"smooth"}); }));
}

function formationHtml(club) {
  const groups = { GK: [], DEF: [], MID: [], ATT: [] };
  club.starting_xi.forEach((p) => groups[positionGroup(p)].push(p));
  return `<div class="formation"><div class="formation-title">Average XI • ${club.formation} • ${club.starting_xi_rating.toFixed(2)}</div>${["ATT","MID","DEF","GK"].map((group) => `<div class="formation-line">${groups[group].map((p) => `<span class="shirt"><b>${num(p.tbg_rating).toFixed(0)}</b>${p.player_name.split(" ").slice(-1)[0]}</span>`).join("")}</div>`).join("")}</div>`;
}

function valueChart(club) {
  const max = Math.max(...club.squad.slice(0,10).map((p) => num(p.market_value_eur)), 1);
  return `<div class="value-chart"><h3>Top squad values</h3>${club.squad.slice(0,10).map((p) => `<div class="value-row"><span>${p.player_name}</span><i style="width:${Math.max(4, num(p.market_value_eur)/max*100)}%"></i><b>${money(p.market_value_eur)}</b></div>`).join("")}</div>`;
}

function renderProfile() {
  const club = state.clubs.find((c) => c.club_id === state.selectedClubId);
  if (!club) return;
  const rows = club.squad.map((p) => `<tr><td><button class="player-link">${p.player_name}</button></td><td>${p.age || "—"}</td><td>${playerPosition(p)}</td><td class="numeric">${money(p.market_value_eur)}</td><td class="numeric"><strong>${num(p.tbg_rating).toFixed(0)}</strong></td></tr>`).join("");
  $("clubProfile").innerHTML = `<div class="profile-head"><img class="club-badge" src="${badgeUrl(club)}" alt="${club.club_name} badge" onerror="this.style.display='none'"/><div><span class="label">Club Profile</span><h2>${club.club_name}</h2><p>${countryFlag(club.country)} ${club.country || "Unknown"} • ${club.league || "Unknown"} • ${club.continent || "Unknown"} • ${club.division || "Outside Top 80"}</p></div></div>
  <div class="profile-grid"><div class="profile-stat"><span>Weighted strength</span><strong>${club.weighted_strength ? club.weighted_strength.toFixed(2) : `${club.raw_strength.toFixed(2)}*`}</strong></div><div class="profile-stat"><span>Starting XI</span><strong>${club.starting_xi_rating.toFixed(2)}</strong></div><div class="profile-stat"><span>Squad value</span><strong>${money(club.total_value)}</strong></div><div class="profile-stat"><span>Average age</span><strong>${club.average_age.toFixed(1)}</strong></div></div>
  <div class="depth-grid">${["GK","DEF","MID","ATT"].map((g) => `<div class="depth-card"><span>${g}</span><strong>${club.depth[g] || 0}</strong></div>`).join("")}</div>
  <p><strong>Best:</strong> ${club.best_player?.player_name || "—"} (${num(club.best_player?.tbg_rating).toFixed(0)}) • <strong>Youngest:</strong> ${club.youngest_player?.player_name || "—"} (${club.youngest_player?.age || "—"}) • <strong>Oldest:</strong> ${club.oldest_player?.player_name || "—"} (${club.oldest_player?.age || "—"})</p>
  ${formationHtml(club)}${valueChart(club)}
  <div class="squad-scroll"><table class="squad-table"><thead><tr><th>Player</th><th>Age</th><th>Position</th><th class="numeric">Value</th><th class="numeric">TBG</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function bindControls() {
  ["clubSearch","divisionFilter","continentFilter","countryFilter","leagueFilter","squadView","ratingMin","valueMin"].forEach((id) => $(id).addEventListener("input", applyFilters));
  $("sortSelect").addEventListener("change", (e) => { state.sort = e.target.value; applyFilters(); });
  $("resetButton").addEventListener("click", () => { ["clubSearch","divisionFilter","continentFilter","countryFilter","leagueFilter","ratingMin","valueMin"].forEach((id) => $(id).value = ""); $("squadView").value = "top80"; $("sortSelect").value = "weighted_strength:desc"; state.sort = "weighted_strength:desc"; applyFilters(); });
}

async function init() {
  try {
    const [players, universe] = await Promise.all([loadJson(PLAYER_URLS), loadJson(UNIVERSE_URLS)]);
    state.clubs = aggregateClubs(players, universe);
    fillSelect("continentFilter", state.clubs.map((c) => c.continent));
    fillSelect("countryFilter", state.clubs.map((c) => c.country));
    fillSelect("leagueFilter", state.clubs.map((c) => c.league));
    setSummary(); bindControls(); applyFilters();
  } catch (error) { $("clubList").innerHTML = `<p>Could not load club database: ${error.message}</p>`; console.error(error); }
}

init();
