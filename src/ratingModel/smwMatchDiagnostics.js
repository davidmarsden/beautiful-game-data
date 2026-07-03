function normaliseName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\b(fc|afc|cf|sc|sk|calcio|club|united fc|city fc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactName(value) {
  return normaliseName(value).replace(/\s+/g, "");
}

function nameTokens(value) {
  return normaliseName(value).split(/\s+/).filter(Boolean);
}

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

function similarity(a, b) {
  const aTokens = new Set(nameTokens(a));
  const bTokens = new Set(nameTokens(b));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = intersection / union;
  const compactScore = compactName(a) === compactName(b) ? 1 : 0;
  const lastA = [...aTokens].at(-1);
  const lastB = [...bTokens].at(-1);
  const lastScore = lastA && lastA === lastB ? 0.25 : 0;
  return Math.min(1, Math.max(tokenScore, compactScore) + lastScore);
}

function clubSimilarity(a, b) {
  if (!a || !b) return 0;
  const normalA = normaliseName(a);
  const normalB = normaliseName(b);
  if (normalA === normalB) return 1;
  if (normalA.includes(normalB) || normalB.includes(normalA)) return 0.8;
  return similarity(a, b);
}

function exactKey(name, club = "") {
  const nameKey = normaliseName(name);
  const clubKey = normaliseName(club);
  return clubKey ? `${nameKey}|${clubKey}` : nameKey;
}

function buildTargetMaps(targetRows) {
  const byNameClub = new Map();
  const byName = new Map();
  for (const row of targetRows ?? []) {
    const name = targetName(row);
    const club = targetClub(row);
    const rating = targetRating(row);
    if (!name || !rating) continue;
    const target = { name, club, rating, raw: row };
    if (club) byNameClub.set(exactKey(name, club), target);
    if (!byName.has(exactKey(name))) byName.set(exactKey(name), target);
  }
  return { byNameClub, byName };
}

function exactMatch(player, maps) {
  const club = playerClub(player);
  const name = player.name;
  if (club && maps.byNameClub.has(exactKey(name, club))) return maps.byNameClub.get(exactKey(name, club));
  return maps.byName.get(exactKey(name)) ?? null;
}

function likelyMatches(player, targets, limit) {
  return targets
    .map((target) => {
      const nameScore = similarity(player.name, target.name);
      const clubScore = clubSimilarity(playerClub(player), target.club);
      const score = Number((nameScore * 0.8 + clubScore * 0.2).toFixed(3));
      return { ...target, score, nameScore: Number(nameScore.toFixed(3)), clubScore: Number(clubScore.toFixed(3)) };
    })
    .filter((target) => target.score >= 0.35)
    .sort((a, b) => b.score - a.score || b.rating - a.rating || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function diagnoseSmwPlayerMatches(pack, targetRows, options = {}) {
  const limit = Number(options.limit ?? 25);
  const suggestionLimit = Number(options.suggestionLimit ?? 3);
  const targets = (targetRows ?? [])
    .map((row) => ({ name: targetName(row), club: targetClub(row), rating: targetRating(row), raw: row }))
    .filter((row) => row.name && row.rating);
  const maps = buildTargetMaps(targetRows);
  const players = Object.values(pack.players ?? {});
  const matched = [];
  const unmatchedPlayers = [];
  const matchedTargetKeys = new Set();

  for (const player of players) {
    const target = exactMatch(player, maps);
    if (target) {
      matched.push({
        playerId: player.id,
        playerName: player.name,
        clubName: playerClub(player),
        modelRating: playerRating(player),
        targetName: target.name,
        targetClub: target.club,
        smwRating: target.rating
      });
      matchedTargetKeys.add(exactKey(target.name, target.club));
      matchedTargetKeys.add(exactKey(target.name));
    } else {
      unmatchedPlayers.push({
        playerId: player.id,
        playerName: player.name,
        clubName: playerClub(player),
        modelRating: playerRating(player),
        suggestions: likelyMatches(player, targets, suggestionLimit)
      });
    }
  }

  const unmatchedTargets = targets
    .filter((target) => !matchedTargetKeys.has(exactKey(target.name, target.club)) && !matchedTargetKeys.has(exactKey(target.name)))
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));

  return {
    summary: {
      packPlayers: players.length,
      targetPlayers: targets.length,
      matched: matched.length,
      unmatchedPackPlayers: unmatchedPlayers.length,
      unmatchedTargets: unmatchedTargets.length,
      matchRate: players.length ? Number((matched.length / players.length).toFixed(3)) : 0
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
    `Unmatched pack players: ${report.summary.unmatchedPackPlayers}`,
    `Unmatched targets: ${report.summary.unmatchedTargets}`,
    "",
    "Matched sample:",
    "Player                   API Club                 SMW Name                 SMW Club                 RT"
  ];

  for (const row of report.matched) {
    lines.push([
      row.playerName.padEnd(24, " "),
      String(row.clubName ?? "").padEnd(24, " "),
      row.targetName.padEnd(24, " "),
      String(row.targetClub ?? "").padEnd(24, " "),
      String(row.smwRating).padStart(2, " ")
    ].join(" "));
  }

  lines.push("", "Unmatched API players with likely SoccerWiki matches:");
  for (const row of report.unmatchedPlayers) {
    lines.push(`- ${row.playerName} (${row.clubName || "unknown"}, model ${row.modelRating || "-"})`);
    for (const suggestion of row.suggestions) {
      lines.push(`  → ${suggestion.name} (${suggestion.club || "unknown"}, ${suggestion.rating}) score=${suggestion.score} name=${suggestion.nameScore} club=${suggestion.clubScore}`);
    }
  }

  lines.push("", "Unmatched SoccerWiki targets:");
  for (const row of report.unmatchedTargets) {
    lines.push(`- ${row.name} (${row.club || "unknown"}, ${row.rating})`);
  }

  return lines.join("\n");
}
