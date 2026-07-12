import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
};
const rows = (value) => Array.isArray(value) ? value : value?.players || value?.items || [];
const text = (value) => String(value ?? "").trim();
const norm = (value) => text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (value) => Number(value) || 0;
const idOf = (p) => text(p.transfermarkt_player_id || p.transfermarkt_id || p.player_id || p.id);
const clubIdOf = (p) => text(p.current_club_id || p.real_club_source_id || p.transfermarkt_club_id || p.club_id);
const nameOf = (p) => text(p.player_name || p.display_name || p.canonical_name || p.name);
const valueOf = (p) => num(p.market_value_eur ?? p.market_value ?? p.value_eur);
const ageOf = (p) => num(p.age);
const ratingOf = (p) => num(p.tbg_rating ?? p.rating);
const leagueOf = (p) => text(p.league || p.current_competition || p.competition_name);
const statusOf = (p) => norm(p.status || p.player_status || p.transfermarkt_status);

function positionGroup(player) {
  const raw = norm([player.position_group, player.position, player.primary_position, player.detailed_position].join(" "));
  if (/goalkeeper|\bgk\b/.test(raw)) return "GK";
  if (/defender|back|centre back|center back|\bcb\b|\blb\b|\brb\b/.test(raw)) return "DEF";
  if (/midfield|\bdm\b|\bcm\b|\bam\b/.test(raw)) return "MID";
  if (/winger|forward|striker|\bcf\b|\bst\b/.test(raw)) return "ATT";
  return "UNK";
}

function expectedRatingFromValue(value, age) {
  if (value >= 120e6) return 95;
  if (value >= 80e6) return 93;
  if (value >= 50e6) return 91;
  if (value >= 30e6) return 89;
  if (value >= 15e6) return 87;
  if (value >= 7.5e6) return 85;
  if (value >= 3e6) return age && age <= 21 ? 82 : 83;
  if (value >= 1e6) return age && age <= 21 ? 78 : 80;
  return age && age <= 21 ? 72 : 76;
}

const configPath = process.argv[2] || "data/config/data-quality-audit.json";
const output = "derived/data-quality/data-quality-audit.json";
const markdown = "derived/data-quality/data-quality-audit.md";
const reviewCsv = "derived/data-quality/data-quality-review.csv";

const [config, universe, masterValue, publishedValue] = await Promise.all([
  readJson(configPath, {}),
  readJson("data/config/tbg-club-universe.json", { clubs: [] }),
  readJson("data/transfermarkt/players-master.json", []),
  readJson("derived/player-database/player-database.json", [])
]);

const master = rows(masterValue);
const published = rows(publishedValue);
const publishedIds = new Set(published.map(idOf).filter(Boolean));
const topClubs = (universe.clubs || []).filter((club) => num(club.slot) <= num(config.top_club_slots || 80));
const masterByClub = new Map();
const publishedByClub = new Map();
for (const player of master) {
  const id = clubIdOf(player); if (!id) continue;
  if (!masterByClub.has(id)) masterByClub.set(id, []);
  masterByClub.get(id).push(player);
}
for (const player of published) {
  const id = clubIdOf(player); if (!id) continue;
  if (!publishedByClub.has(id)) publishedByClub.set(id, []);
  publishedByClub.get(id).push(player);
}

const targets = config.squad_targets;
const review = [];
const clubs = topClubs.map((club) => {
  const clubId = text(club.transfermarkt_club_id);
  const imported = masterByClub.get(clubId) || [];
  const squad = publishedByClub.get(clubId) || [];
  const senior = squad.filter((p) => ageOf(p) >= targets.senior_min_age);
  const youth = squad.filter((p) => ageOf(p) > 0 && ageOf(p) <= targets.youth_max_age);
  const depth = squad.reduce((memo, p) => { const g = positionGroup(p); memo[g] = (memo[g] || 0) + 1; return memo; }, {});
  const isBigFive = config.big_five_leagues.includes(club.league);

  const importedCandidates = imported.filter((p) => !publishedIds.has(idOf(p)) && !/retired|without club|free agent/.test(statusOf(p)));
  const seniorCandidates = importedCandidates.filter((p) => ageOf(p) >= targets.senior_min_age && valueOf(p) >= config.priority_candidate_rules.senior_min_market_value_eur);
  const youthCandidates = importedCandidates.filter((p) => ageOf(p) > 0 && ageOf(p) <= targets.youth_max_age && valueOf(p) >= config.priority_candidate_rules.youth_min_market_value_eur);
  const eliteYouthMissing = youthCandidates.filter((p) => valueOf(p) >= config.priority_candidate_rules.elite_youth_min_market_value_eur);

  const issues = [];
  if (squad.length < targets.minimum_playable) issues.push({ severity: "critical", type: "not_playable", detail: `${squad.length}/${targets.minimum_playable} players` });
  if (senior.length < targets.first_team_target) issues.push({ severity: "warning", type: "senior_depth", detail: `${senior.length}/${targets.first_team_target} senior players` });
  if (youth.length < targets.development_target) issues.push({ severity: "warning", type: "development_depth", detail: `${youth.length}/${targets.development_target} U21 players` });
  if (squad.length > targets.maximum_total) issues.push({ severity: "warning", type: "over_limit", detail: `${squad.length}/${targets.maximum_total} squad limit` });
  for (const [group, minimum] of Object.entries(config.position_minimums)) {
    if ((depth[group] || 0) < minimum) issues.push({ severity: "warning", type: "position_depth", detail: `${group}: ${depth[group] || 0}/${minimum}` });
  }
  if (isBigFive && seniorCandidates.length) issues.push({ severity: "review", type: "missing_valuable_senior", detail: `${seniorCandidates.length} imported senior candidates outside published pool` });
  if (isBigFive && youthCandidates.length) issues.push({ severity: "review", type: "missing_development", detail: `${youthCandidates.length} imported U21 candidates outside published pool` });
  if (eliteYouthMissing.length) issues.push({ severity: "critical", type: "missing_elite_youth", detail: eliteYouthMissing.map(nameOf).join(", ") });

  const suspiciousRatings = squad.map((p) => {
    const expected = expectedRatingFromValue(valueOf(p), ageOf(p));
    const gap = ratingOf(p) - expected;
    return { player: p, expected, gap };
  }).filter((x) => valueOf(x.player) >= config.priority_candidate_rules.rating_value_floor_eur && Math.abs(x.gap) >= config.priority_candidate_rules.rating_gap_warning);
  if (suspiciousRatings.length) issues.push({ severity: "review", type: "rating_sanity", detail: `${suspiciousRatings.length} ratings differ materially from value benchmark` });

  for (const player of [...seniorCandidates, ...youthCandidates]) review.push({
    priority: valueOf(player) >= config.priority_candidate_rules.elite_youth_min_market_value_eur ? "high" : "medium",
    club: club.name,
    league: club.league,
    issue: ageOf(player) <= targets.youth_max_age ? "missing_development_candidate" : "missing_senior_candidate",
    player: nameOf(player), age: ageOf(player), market_value_eur: valueOf(player), tbg_rating: ratingOf(player), transfermarkt_player_id: idOf(player)
  });
  for (const item of suspiciousRatings) review.push({
    priority: "medium", club: club.name, league: club.league, issue: "rating_sanity", player: nameOf(item.player), age: ageOf(item.player), market_value_eur: valueOf(item.player), tbg_rating: ratingOf(item.player), expected_rating: item.expected, gap: item.gap, transfermarkt_player_id: idOf(item.player)
  });

  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + ({ critical: 15, warning: 6, review: 3 }[issue.severity] || 0), 0));
  return {
    slot: club.slot, club_name: club.name, club_id: clubId, league: club.league, country: club.country,
    imported_players: imported.length, published_players: squad.length, senior_players: senior.length, development_players_u21: youth.length,
    depth, senior_candidates_missing: seniorCandidates.length, development_candidates_missing: youthCandidates.length,
    elite_youth_missing: eliteYouthMissing.map((p) => ({ player_name: nameOf(p), age: ageOf(p), market_value_eur: valueOf(p), transfermarkt_player_id: idOf(p) })),
    suspicious_ratings: suspiciousRatings.map((x) => ({ player_name: nameOf(x.player), rating: ratingOf(x.player), expected_rating: x.expected, gap: x.gap, market_value_eur: valueOf(x.player) })),
    health_score: score, status: issues.some((i) => i.severity === "critical") ? "critical" : issues.length ? "review" : "healthy", issues
  };
});

const allPlayers = [...master, ...published];
const prospects = (config.tracked_prospects || []).map((prospect) => {
  const matches = allPlayers.filter((p) => norm(nameOf(p)) === norm(prospect.name));
  const preferred = matches.find((p) => publishedIds.has(idOf(p))) || matches.sort((a, b) => valueOf(b) - valueOf(a))[0];
  return {
    name: prospect.name,
    found: Boolean(preferred),
    published: preferred ? publishedIds.has(idOf(preferred)) : false,
    club: preferred ? text(preferred.current_club || preferred.club_name) : null,
    age: preferred ? ageOf(preferred) : null,
    market_value_eur: preferred ? valueOf(preferred) : null,
    tbg_rating: preferred ? ratingOf(preferred) : null,
    transfermarkt_player_id: preferred ? idOf(preferred) : null,
    status: !preferred ? "missing" : !publishedIds.has(idOf(preferred)) ? "not_published" : "ok"
  };
});

review.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - ({ high: 0, medium: 1, low: 2 }[b.priority])) || b.market_value_eur - a.market_value_eur);
const summary = {
  clubs: clubs.length,
  healthy: clubs.filter((c) => c.status === "healthy").length,
  review: clubs.filter((c) => c.status === "review").length,
  critical: clubs.filter((c) => c.status === "critical").length,
  first_team_target_met: clubs.filter((c) => c.senior_players >= targets.first_team_target).length,
  development_target_met: clubs.filter((c) => c.development_players_u21 >= targets.development_target).length,
  review_items: review.length
};
const report = { generated_at: new Date().toISOString(), policy: config, summary, tracked_prospects: prospects, clubs, review_queue: review };

const md = [
  "# TBG Data Quality Audit", "", `Generated: ${report.generated_at}`, "",
  "## Summary", `- Healthy clubs: ${summary.healthy}/${summary.clubs}`, `- Review: ${summary.review}`, `- Critical: ${summary.critical}`,
  `- First-team target met: ${summary.first_team_target_met}/${summary.clubs}`, `- Development target met: ${summary.development_target_met}/${summary.clubs}`, `- Review queue: ${summary.review_items}`, "",
  "## Tracked prospects", ...prospects.map((p) => `- ${p.name}: ${p.status}${p.found ? ` — ${p.club || "Unknown club"}, age ${p.age || "?"}, €${Math.round((p.market_value_eur || 0) / 1e6)}m, TBG ${p.tbg_rating || "?"}` : ""}`), "",
  "## Clubs needing attention", ...clubs.filter((c) => c.status !== "healthy").sort((a, b) => a.health_score - b.health_score).map((c) => `- ${c.club_name} (${c.league}) — health ${c.health_score}; ${c.published_players} total, ${c.senior_players} senior, ${c.development_players_u21} U21 — ${c.issues.map((i) => i.detail).join("; ")}`), "",
  "## Highest-priority review items", ...review.slice(0, 200).map((r) => `- [${r.priority}] ${r.club}: ${r.player} (${r.age || "?"}) — ${r.issue} — €${Math.round((r.market_value_eur || 0) / 1e6)}m${r.tbg_rating ? ` — TBG ${r.tbg_rating}` : ""}`)
].join("\n") + "\n";

const headers = ["priority","club","league","issue","player","age","market_value_eur","tbg_rating","expected_rating","gap","transfermarkt_player_id"];
const csv = [headers.join(","), ...review.map((row) => headers.map((key) => `"${String(row[key] ?? "").replaceAll('"','""')}"`).join(","))].join("\n") + "\n";
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
await writeFile(markdown, md);
await writeFile(reviewCsv, csv);
console.log(JSON.stringify(summary, null, 2));
console.log(`Wrote ${output}, ${markdown} and ${reviewCsv}`);
