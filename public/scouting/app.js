const state = {
  players: [],
  filtered: [],
  sortKey: "tbg_rating",
  sortDirection: "desc",
  page: 1,
  perPage: 50,
  unsignedOnly: false
};

const els = {
  searchBox: document.querySelector("#searchBox"),
  positionFilter: document.querySelector("#positionFilter"),
  clubFilter: document.querySelector("#clubFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  ratingMin: document.querySelector("#ratingMin"),
  ageMax: document.querySelector("#ageMax"),
  valueMin: document.querySelector("#valueMin"),
  resetButton: document.querySelector("#resetButton"),
  toggleUnsigned: document.querySelector("#toggleUnsigned"),
  tbody: document.querySelector("#playersTable tbody"),
  resultCount: document.querySelector("#resultCount"),
  pageLabel: document.querySelector("#pageLabel"),
  prevPage: document.querySelector("#prevPage"),
  nextPage: document.querySelector("#nextPage"),
  summaryPlayers: document.querySelector("#summaryPlayers"),
  summaryElite: document.querySelector("#summaryElite"),
  summaryUnsigned: document.querySelector("#summaryUnsigned"),
  summaryYoung: document.querySelector("#summaryYoung")
};

const DATA_URLS = [
  "../../derived/player-database/player-database.json",
  "../derived/player-database/player-database.json",
  "./player-database.json",
  "/derived/player-database/player-database.json"
];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value) {
  return String(value ?? "").trim();
}

function playerPosition(player) {
  return text(player.position || player.primary_position || player.detailed_position || player.position_group) || "—";
}

function formatValue(value) {
  const amount = number(value);
  if (!amount) return "—";
  if (amount >= 1_000_000) return `€${(amount / 1_000_000).toFixed(amount >= 100_000_000 ? 0 : 1)}m`;
  if (amount >= 1_000) return `€${(amount / 1_000).toFixed(0)}k`;
  return `€${amount}`;
}

function niceBand(value) {
  return text(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "—";
}

function uniqueOptions(players, getter) {
  return [...new Set(players.map(getter).map(text).filter(Boolean).filter((value) => value !== "—"))]
    .sort((a, b) => a.localeCompare(b));
}

function fillSelect(select, values) {
  const first = select.querySelector("option")?.outerHTML || "<option value=''>All</option>";
  select.innerHTML = first + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSearchHaystack(player) {
  return [
    player.player_name,
    player.current_club,
    player.tbg_club,
    player.nationality,
    playerPosition(player),
    player.position_group,
    player.rating_band,
    player.status
  ].map(text).join(" ").toLowerCase();
}

function isUnsigned(player) {
  const status = text(player.assignment_status).toLowerCase();
  const club = text(player.tbg_club || player.current_club).toLowerCase();
  return status === "unsigned" || club === "without club" || !text(player.tbg_club);
}

function applyFilters() {
  const query = text(els.searchBox.value).toLowerCase();
  const position = text(els.positionFilter.value);
  const club = text(els.clubFilter.value);
  const status = text(els.statusFilter.value);
  const ratingMin = number(els.ratingMin.value);
  const ageMax = number(els.ageMax.value);
  const valueMin = number(els.valueMin.value) * 1_000_000;

  state.filtered = state.players.filter((player) => {
    if (query && !getSearchHaystack(player).includes(query)) return false;
    if (position && playerPosition(player) !== position) return false;
    if (club && text(player.current_club) !== club) return false;
    if (status && text(player.status) !== status) return false;
    if (ratingMin && number(player.tbg_rating) < ratingMin) return false;
    if (ageMax && number(player.age) > ageMax) return false;
    if (valueMin && number(player.market_value_eur) < valueMin) return false;
    if (state.unsignedOnly && !isUnsigned(player)) return false;
    return true;
  });

  sortPlayers();
  state.page = 1;
  render();
}

function sortPlayers() {
  const key = state.sortKey;
  const direction = state.sortDirection === "asc" ? 1 : -1;
  state.filtered.sort((a, b) => {
    const av = key === "position_group" ? playerPosition(a) : a[key];
    const bv = key === "position_group" ? playerPosition(b) : b[key];
    const an = number(av);
    const bn = number(bv);
    const bothNumeric = an || bn || ["age", "market_value_eur", "tbg_rating"].includes(key);
    if (bothNumeric && an !== bn) return (an - bn) * direction;
    return text(av).localeCompare(text(bv)) * direction;
  });
}

function renderSummary() {
  const total = state.players.length;
  const elite = state.players.filter((player) => number(player.tbg_rating) >= 90).length;
  const unsigned = state.players.filter(isUnsigned).length;
  const young = state.players.filter((player) => number(player.age) && number(player.age) <= 21).length;
  els.summaryPlayers.textContent = `${total.toLocaleString()} players filed`;
  els.summaryElite.textContent = `${elite.toLocaleString()} rated 90+`;
  els.summaryUnsigned.textContent = `${unsigned.toLocaleString()} in the pool`;
  els.summaryYoung.textContent = `${young.toLocaleString()} aged 21 or under`;
}

function render() {
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.perPage));
  state.page = Math.min(Math.max(1, state.page), totalPages);
  const start = (state.page - 1) * state.perPage;
  const pageRows = state.filtered.slice(start, start + state.perPage);

  els.resultCount.textContent = `${state.filtered.length.toLocaleString()} players found`;
  els.pageLabel.textContent = `Page ${state.page} of ${totalPages}`;
  els.prevPage.disabled = state.page <= 1;
  els.nextPage.disabled = state.page >= totalPages;

  els.tbody.innerHTML = pageRows.map((player) => `
    <tr>
      <td>
        <span class="player-name">${escapeHtml(player.player_name)}</span>
        <span class="subtle">${escapeHtml(player.transfermarkt_player_id || player.tbg_player_id)}</span>
      </td>
      <td>${escapeHtml(player.age || "—")}</td>
      <td>${escapeHtml(playerPosition(player))}</td>
      <td>${escapeHtml(player.current_club || "Without Club")}</td>
      <td>${escapeHtml(player.nationality || "—")}</td>
      <td>${formatValue(player.market_value_eur)}</td>
      <td><span class="rating-pill">${escapeHtml(player.tbg_rating || "—")}</span></td>
      <td>${escapeHtml(niceBand(player.rating_band))}</td>
      <td>${escapeHtml(player.status || player.assignment_status || "—")}</td>
    </tr>
  `).join("");
}

async function loadData() {
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

function bindEvents() {
  [els.searchBox, els.positionFilter, els.clubFilter, els.statusFilter, els.ratingMin, els.ageMax, els.valueMin]
    .forEach((element) => element.addEventListener("input", applyFilters));

  els.resetButton.addEventListener("click", () => {
    els.searchBox.value = "";
    els.positionFilter.value = "";
    els.clubFilter.value = "";
    els.statusFilter.value = "";
    els.ratingMin.value = "";
    els.ageMax.value = "";
    els.valueMin.value = "";
    state.unsignedOnly = false;
    els.toggleUnsigned.setAttribute("aria-pressed", "false");
    applyFilters();
  });

  els.toggleUnsigned.addEventListener("click", () => {
    state.unsignedOnly = !state.unsignedOnly;
    els.toggleUnsigned.setAttribute("aria-pressed", String(state.unsignedOnly));
    applyFilters();
  });

  els.prevPage.addEventListener("click", () => { state.page -= 1; render(); });
  els.nextPage.addEventListener("click", () => { state.page += 1; render(); });

  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
      else {
        state.sortKey = key;
        state.sortDirection = ["player_name", "current_club", "position_group", "nationality", "status", "rating_band"].includes(key) ? "asc" : "desc";
      }
      sortPlayers();
      render();
    });
  });
}

async function init() {
  try {
    state.players = await loadData();
    state.filtered = [...state.players];
    fillSelect(els.positionFilter, uniqueOptions(state.players, playerPosition));
    fillSelect(els.clubFilter, uniqueOptions(state.players, (player) => player.current_club));
    renderSummary();
    bindEvents();
    applyFilters();
  } catch (error) {
    els.resultCount.textContent = "Could not load player database";
    els.tbody.innerHTML = `<tr><td colspan="9">${escapeHtml(error.message)}</td></tr>`;
    console.error(error);
  }
}

init();
