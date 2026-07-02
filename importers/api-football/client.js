import { setTimeout as sleep } from "node:timers/promises";
import { API_FOOTBALL_CONFIG, getApiFootballKey } from "./config.js";

function hasErrors(errors) {
  if (!errors) return false;
  if (Array.isArray(errors)) return errors.length > 0;
  if (typeof errors === "object") return Object.keys(errors).length > 0;
  return Boolean(errors);
}

function retryAfterMs(response, fallbackMs) {
  const header = response.headers?.get?.("retry-after");
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
}

export class ApiFootballClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? API_FOOTBALL_CONFIG.baseUrl;
    this.apiKey = options.apiKey ?? getApiFootballKey(options.env);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.requestDelayMs = Number(options.requestDelayMs ?? process.env.API_FOOTBALL_REQUEST_DELAY_MS ?? 1200);
    this.maxRetries = Number(options.maxRetries ?? process.env.API_FOOTBALL_MAX_RETRIES ?? 3);
    this.retryBaseMs = Number(options.retryBaseMs ?? process.env.API_FOOTBALL_RETRY_BASE_MS ?? 5000);
    this.lastRequestAt = 0;

    if (typeof this.fetchImpl !== "function") {
      throw new Error("ApiFootballClient requires a fetch implementation.");
    }
  }

  async waitForTurn() {
    const now = Date.now();
    const waitMs = Math.max(0, this.lastRequestAt + this.requestDelayMs - now);
    if (waitMs > 0) await sleep(waitMs);
    this.lastRequestAt = Date.now();
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

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForTurn();

      const response = await this.fetchImpl(url, {
        headers: {
          "x-apisports-key": this.apiKey
        }
      });

      if (response.status === 429 && attempt < this.maxRetries) {
        const waitMs = retryAfterMs(response, this.retryBaseMs * (attempt + 1));
        console.warn(`API-Football rate limited ${url.pathname}. Retrying in ${waitMs}ms.`);
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        throw new Error(`API-Football request failed: ${response.status}`);
      }

      const payload = await response.json();

      if (hasErrors(payload.errors)) {
        throw new Error(`API-Football returned errors for ${url.pathname}: ${JSON.stringify(payload.errors)}`);
      }

      return payload.response ?? [];
    }

    throw new Error(`API-Football request failed after retries: ${url.pathname}`);
  }

  status() {
    return this.request("/status");
  }

  leagues({ leagueId, season }) {
    return this.request("/leagues", { id: leagueId, season });
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
