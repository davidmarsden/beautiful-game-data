const DATA_URLS = [
  "./scouting/player-database.json",
  "./derived/player-database/player-database.json",
  "/beautiful-game-data/scouting/player-database.json"
];

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function init() {
  try {
    const players = await loadPlayers();
    const elite = players.filter((player) => number(player.tbg_rating) >= 90).length;
    const young = players.filter((player) => number(player.age) && number(player.age) <= 21).length;
    setText("playersCount", players.length.toLocaleString());
    setText("eliteCount", elite.toLocaleString());
    setText("youngCount", young.toLocaleString());
  } catch (error) {
    console.error(error);
    setText("playersCount", "Live");
    setText("eliteCount", "TBG");
    setText("youngCount", "Soon");
  }
}

init();
