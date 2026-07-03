import {
  matchIdentity,
  playerClubKey,
  playerIdentityKey,
  targetIdentityKey
} from "./playerIdentity.js";

function targetName(row) {
  return row.name ?? row.playerName ?? row.player ?? "";
}

function targetClub(row) {
  return row.club ?? row.clubName ?? row.team ?? row.teamName ?? "";
}

function targetRating(row) {
  return Number(row.smwRating ?? row.soccerwikiRating ?? row.targetRating ?? row.rating ?? row.rt ?? 0);
}

function playerClub(player) {
  return player.team?.name ?? player.clubName ?? player.teamName ?? "";
}

function playerRating(player) {
  return Number(player.ratings?.effectiveMatchRating ?? player.ratings?.ability ?? player.ability ?? player.rating ?? 0);
}

function buildTargetMaps(targetRows) {
  const byNameClub = new Map();
  const byName = new Map();
  const targets = [];

  for (const row of targetRows ?? []) {
    const name = targetName(row);
    const club = targetClub(row);
    const rating = targetRating(row);
    if (!name || !rating) continue;

    const target = { name, club, rating, raw: row };
    target.identityKey = targetIdentityKey(target);
    targets.push(target);
    if (club) byNameClub.set(playerClubKey(name, club), target);
    if (!byName.has(playerIdentityKey(name))) byName.set(playerIdentityKey(name), target);
  }

  return { byNameClub, byName, targets };
}

function candidateMatches(player, maps, options = {}) {
  const club = playerClub(player);
  const name = player.name;
  const source = { name, club };
  const candidates = [];

  if (club && maps.byNameClub.has(playerClubKey(name, club))) {
    const target = maps.byNameClub.get(playerClubKey(name, club));
    candidates.push({ ...target, confidence: 1, reason: "exact-name-club", nameScore: 1, clubScore: 1, clubMismatch: false });
  }

  const identityResult = matchIdentity(source, maps.targets, { ...options, minConfidence: 2 });
  candidates.push(...identityResult.candidates);

  if (maps.byName.has(playerIdentityKey(name))) {
    const target = maps.byName.get(playerIdentityKey(name));
    candidates.push({ ...target, confidence: 1, reason: "exact-name", nameScore: 1, clubScore: 0, clubMismatch: true });
  }

  const byTarget = new Map();
  for (const candidate of candidates) {
    const key = targetIdentityKey(candidate);
    const current = byTarget.get(key);
    if (!current || candidate.confidence > current.confidence || candidate.clubScore > current.clubScore) {
      byTarget.set(key, { ...candidate, identityKey: key });
    }
  }

  return [...byTarget.values()].sort((a, b) => b.confidence - a.confidence || b.clubScore - a.clubScore || b.nameScore - a.nameScore || String(a.name).localeCompare(String(b.name)));
}

function likelyMatches(player, targets, limit) {
  return matchIdentity(
    { name: player.name, club: playerClub(player) },
    targets,
    { minConfidence: 2 }
  ).candidates.slice(0, limit).map((candidate) => ({
    ...candidate,
    score: candidate.confidence
  }));
}

export function diagnoseSmwPlayerMatches(pack, targetRows, options = {}) {
  const limit = Number(options.limit ?? 25);
  const suggestionLimit = Number(options.suggestionLimit ?? 3);
  const matchOptions = {
    minConfidence: Number(options.minConfidence ?? 0.95),
    clubTieBreakConfidence: Number(options.clubTieBreakConfidence ?? 0.85)
  };
  const maps = buildTargetMaps(targetRows);
  const players = Object.values(pack.players ?? {});
  const proposals = [];
  const unmatchedPlayers = [];
  let clubMismatchMatches = 0;
  const confidenceCounts = {};

  for (const player of players) {
    const candidates = candidateMatches(player, maps, matchOptions).filter((candidate) => candidate.confidence >= matchOptions.minConfidence);
    for (const candidate of candidates) {
      proposals.push({
        player,
        target: candidate,
        targetKey: targetIdentityKey(candidate),
        confidence: candidate.confidence,
        clubScore: candidate.clubScore,
        nameScore: candidate.nameScore
      });
    }
  }

  proposals.sort((a, b) => b.confidence - a.confidence || b.clubScore - a.clubScore || b.nameScore - a.nameScore || playerRating(b.player) - playerRating(a.player));

  const matched = [];
  const matchedPlayerIds = new Set();
  const matchedTargetKeys = new Set();

  for (const proposal of proposals) {
    if (matchedPlayerIds.has(proposal.player.id) || matchedTargetKeys.has(proposal.targetKey)) continue;
    matchedPlayerIds.add(proposal.player.id);
    matchedTargetKeys.add(proposal.targetKey);

    const { player, target } = proposal;
    if (target.clubMismatch) clubMismatchMatches += 1;
    confidenceCounts[target.reason] = (confidenceCounts[target.reason] ?? 0) + 1;
    matched.push({
      playerId: player.id,
      playerName: player.name,
      clubName: playerClub(player),
      modelRating: playerRating(player),
      targetName: target.name,
      targetClub: target.club,
      smwRating: target.rating,
      confidence: target.confidence,
      matchReason: target.reason,
      nameScore: target.nameScore,
      clubScore: target.clubScore,
      clubMismatch: target.clubMismatch
    });
  }

  for (const player of players) {
    if (matchedPlayerIds.has(player.id)) continue;
    unmatchedPlayers.push({
      playerId: player.id,
      playerName: player.name,
      clubName: playerClub(player),
      modelRating: playerRating(player),
      suggestions: likelyMatches(player, maps.targets, suggestionLimit)
    });
  }

  const unmatchedTargets = maps.targets
    .filter((target) => !matchedTargetKeys.has(targetIdentityKey(target)))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));

  return {
    summary: {
      packPlayers: players.length,
      targetPlayers: maps.targets.length,
      matched: matched.length,
      unmatchedPackPlayers: unmatchedPlayers.length,
      unmatchedTargets: unmatchedTargets.length,
      matchRate: players.length ? Number((matched.length / players.length).toFixed(3)) : 0,
      targetMatchRate: maps.targets.length ? Number((matched.length / maps.targets.length).toFixed(3)) : 0,
      clubMismatchMatches,
      confidenceCounts
    },
    matched: matched.slice(0, limit),
    unmatchedPlayers: unmatchedPlayers
      .sort((a, b) => b.modelRating - a.modelRating || a.playerName.localeCompare(b.playerName))
      .slice(0, limit),
    unmatchedTargets: unmatchedTargets.slice(0, limit)
  };
}

export function formatSmwMatchDiagnostics(report) {
  const lines = [
    "# SMW Match Diagnostics",
    `Pack players: ${report.summary.packPlayers}`,
    `Target players: ${report.summary.targetPlayers}`,
    `Matched: ${report.summary.matched}`,
    `Match rate: ${Math.round(report.summary.matchRate * 100)}%`,
    `Target match rate: ${Math.round((report.summary.targetMatchRate ?? 0) * 100)}%`,
    `Club mismatch matches: ${report.summary.clubMismatchMatches ?? 0}`,
    `Unmatched pack players: ${report.summary.unmatchedPackPlayers}`,
    `Unmatched targets: ${report.summary.unmatchedTargets}`,
    "",
    "Confidence counts:",
    ...Object.entries(report.summary.confidenceCounts ?? {}).map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "Matched sample:",
    "Player                   API Club                 SMW Name                 SMW Club                 RT Conf Reason"
  ];

  for (const row of report.matched) {
    lines.push([
      row.playerName.padEnd(24, " "),
      String(row.clubName ?? "").padEnd(24, " "),
      row.targetName.padEnd(24, " "),
      String(row.targetClub ?? "").padEnd(24, " "),
      String(row.smwRating).padStart(2, " "),
      String(row.confidence ?? "").padStart(4, " "),
      row.matchReason ?? ""
    ].join(" "));
  }

  lines.push("", "Unmatched API players with likely SoccerWiki matches:");
  for (const row of report.unmatchedPlayers) {
    lines.push(`- ${row.playerName} (${row.clubName || "unknown"}, model ${row.modelRating || "-"})`);
    for (const suggestion of row.suggestions) {
      lines.push(`  → ${suggestion.name} (${suggestion.club || "unknown"}, ${suggestion.rating}) confidence=${suggestion.confidence} reason=${suggestion.reason} name=${suggestion.nameScore} club=${suggestion.clubScore}`);
    }
  }

  lines.push("", "Unmatched SoccerWiki targets:");
  for (const row of report.unmatchedTargets) {
    lines.push(`- ${row.name} (${row.club || "unknown"}, ${row.rating})`);
  }

  return lines.join("\n");
}
