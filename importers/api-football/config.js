export const API_FOOTBALL_CONFIG = Object.freeze({
  provider: "api-football",
  baseUrl: "https://v3.football.api-sports.io",
  requiredEnvVars: ["API_FOOTBALL_KEY"],
  snapshotVersion: "api-football-snapshot-v0.1"
});

export function getApiFootballKey(env = process.env) {
  return env.API_FOOTBALL_KEY ?? null;
}
