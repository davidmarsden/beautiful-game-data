import { API_FOOTBALL_CONFIG, getApiFootballKey } from "./config.js";

export class ApiFootballClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? API_FOOTBALL_CONFIG.baseUrl;
    this.apiKey = options.apiKey ?? getApiFootballKey(options.env);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("ApiFootballClient requires a fetch implementation.");
    }
  }

  async request(path, params = {}) {
    if (!this.apiKey) {
      throw new Error("Missing API_FOOTBALL_KEY.");
    }

    const url = new URL(path, this.baseUrl);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchImpl(url, {
      headers: {
        "x-apisports-key": this.apiKey
      }
    });

    if (!response.ok) {
      throw new Error(`API-Football request failed: ${response.status}`);
    }

    const payload = await response.json();
    return payload.response ?? [];
  }

  playersByLeagueSeason({ leagueId, season, page = 1 }) {
    return this.request("/players", { league: leagueId, season, page });
  }

  teamsByLeagueSeason({ leagueId, season }) {
    return this.request("/teams", { league: leagueId, season });
  }

  fixturesByLeagueSeason({ leagueId, season }) {
    return this.request("/fixtures", { league: leagueId, season });
  }

  standingsByLeagueSeason({ leagueId, season }) {
    return this.request("/standings", { league: leagueId, season });
  }

  coachesByTeam({ teamId }) {
    return this.request("/coachs", { team: teamId });
  }
}
