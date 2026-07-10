/* Pink Final Club Database v1.1 enhancements */

function detailedRole(player) {
  const raw = String(player.position || player.primary_position || player.detailed_position || player.position_group || "").toLowerCase();
  if (raw.includes("goalkeeper")) return "GK";
  if (raw.includes("right-back") || raw.includes("right back")) return "RB";
  if (raw.includes("left-back") || raw.includes("left back")) return "LB";
  if (raw.includes("centre-back") || raw.includes("center-back") || raw.includes("centre back")) return "CB";
  if (raw.includes("defensive midfield")) return "DM";
  if (raw.includes("attacking midfield")) return "AM";
  if (raw.includes("central midfield") || raw.includes("centre midfield")) return "CM";
  if (raw.includes("right winger") || raw.includes("right wing")) return "RW";
  if (raw.includes("left winger") || raw.includes("left wing")) return "LW";
  if (raw.includes("second striker")) return "SS";
  if (raw.includes("centre-forward") || raw.includes("center-forward") || raw.includes("striker")) return "ST";
  if (raw.includes("midfield")) return "CM";
  if (raw.includes("defender") || raw.includes("back")) return "CB";
  if (raw.includes("winger") || raw.includes("forward")) return "ST";
  return positionGroup(player);
}

function takeBest(pool, used, count) {
  return pool.filter((player) => !used.has(player)).sort((a, b) => num(b.tbg_rating) - num(a.tbg_rating)).slice(0, count);
}

selectStartingXI = function selectStartingXIByRole(squad) {
  const byRole = {};
  squad.forEach((player) => {
    const role = detailedRole(player);
    if (!byRole[role]) byRole[role] = [];
    byRole[role].push(player);
  });
  Object.values(byRole).forEach((pool) => pool.sort((a, b) => num(b.tbg_rating) - num(a.tbg_rating)));

  const plans = [
    { name: "4-3-3", slots: [["GK"],["RB","CB","CB","LB"],["DM","CM","CM"],["RW","ST","LW"]] },
    { name: "4-2-3-1", slots: [["GK"],["RB","CB","CB","LB"],["DM","DM","RW","AM","LW"],["ST"]] },
    { name: "4-4-2", slots: [["GK"],["RB","CB","CB","LB"],["RW","CM","CM","LW"],["ST","ST"]] },
    { name: "3-4-3", slots: [["GK"],["CB","CB","CB"],["RB","CM","CM","LB"],["RW","ST","LW"]] },
    { name: "3-5-2", slots: [["GK"],["CB","CB","CB"],["RB","DM","CM","AM","LB"],["ST","ST"]] }
  ];

  function candidatesFor(role) {
    const fallbacks = {
      GK: ["GK"], RB: ["RB","CB"], LB: ["LB","CB"], CB: ["CB","RB","LB"],
      DM: ["DM","CM","CB"], CM: ["CM","DM","AM"], AM: ["AM","CM","SS"],
      RW: ["RW","LW","AM","ST"], LW: ["LW","RW","AM","ST"], ST: ["ST","SS","RW","LW"]
    };
    return (fallbacks[role] || [role]).flatMap((key) => byRole[key] || []);
  }

  let best = null;
  for (const plan of plans) {
    const used = new Set();
    const lines = [];
    let penalty = 0;
    for (const line of plan.slots) {
      const selected = [];
      for (const role of line) {
        const exact = (byRole[role] || []).find((player) => !used.has(player));
        const player = exact || candidatesFor(role).find((candidate) => !used.has(candidate));
        if (player) {
          used.add(player);
          selected.push({ player, role, natural: Boolean(exact) });
          if (!exact) penalty += 0.45;
        }
      }
      lines.push(selected);
    }
    const players = lines.flat().map((entry) => entry.player);
    if (players.length < 11) continue;
    const rating = average(players.map((p) => p.tbg_rating)) - penalty;
    if (!best || rating > best.score) best = { formation: plan.name, players, lines, rating: average(players.map((p) => p.tbg_rating)), score: rating };
  }

  if (best) return best;
  const players = squad.slice(0, 11);
  return { formation: "Best XI", players, lines: [players.map((player) => ({ player, role: detailedRole(player), natural: true }))], rating: average(players.map((p) => p.tbg_rating)) };
};

const originalAggregateClubs = aggregateClubs;
aggregateClubs = function enhancedAggregateClubs(players, universe) {
  const clubs = originalAggregateClubs(players, universe);
  clubs.forEach((club) => {
    const xi = selectStartingXI(club.squad);
    club.starting_xi = xi.players;
    club.starting_xi_lines = xi.lines;
    club.starting_xi_rating = xi.rating;
    club.formation = xi.formation;
  });

  const canonical = (universe.clubs || []).filter((club) => num(club.slot) <= TOP_WORLD_CLUBS);
  const byTmId = new Map(clubs.map((club) => [String(club.transfermarkt_club_id), club]));
  const audit = canonical.map((expected) => {
    const resolved = byTmId.get(String(expected.transfermarkt_club_id));
    return { ...expected, resolved_name: resolved?.club_name || null, players: resolved?.squad_size || 0, status: !resolved ? "missing" : resolved.squad_size < MIN_PLAYABLE_SQUAD ? "incomplete" : "playable" };
  });
  window.clubUniverseAudit = audit;
  queueMicrotask(renderUniverseAudit);
  return clubs;
};

function renderUniverseAudit() {
  const audit = window.clubUniverseAudit || [];
  const problemClubs = audit.filter((club) => club.status !== "playable");
  const panel = document.getElementById("universeAudit");
  if (!panel || !audit.length) return;
  panel.hidden = false;
  panel.innerHTML = `
    <span class="label">Top 80 Audit</span>
    <h2>${audit.length - problemClubs.length}/80 squads playable</h2>
    ${problemClubs.length ? `<p><strong>Needs attention:</strong> ${problemClubs.map((club) => `${club.slot}. ${club.name} — ${club.players} players (${club.status})`).join(" • ")}</p>` : "<p>All canonical Top 80 clubs have playable squads.</p>"}
  `;
}

function playerProfileHref(player) {
  const id = encodeURIComponent(player.tbg_player_id || player.transfermarkt_player_id || player.player_name);
  return `../players/?id=${id}`;
}

function distributionChart(title, buckets) {
  const maximum = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return `<div class="distribution-chart"><h3>${title}</h3>${buckets.map((bucket) => `<div class="distribution-row"><span>${bucket.label}</span><i style="width:${Math.max(3, bucket.count / maximum * 100)}%"></i><b>${bucket.count}</b></div>`).join("")}</div>`;
}

function bucketPlayers(players, boundaries, getter) {
  return boundaries.map(({ label, min, max }) => ({ label, count: players.filter((player) => { const value = num(getter(player)); return value >= min && value <= max; }).length }));
}

formationHtml = function roleAwareFormationHtml(club) {
  const lines = club.starting_xi_lines || [];
  return `<div class="formation"><div class="formation-title">Average XI • ${club.formation} • ${club.starting_xi_rating.toFixed(2)}</div>${[...lines].reverse().map((line) => `<div class="formation-line">${line.map((entry) => `<span class="shirt ${entry.natural ? "" : "makeshift"}" title="${entry.role}${entry.natural ? "" : " (secondary fit)"}"><b>${num(entry.player.tbg_rating).toFixed(0)}</b>${entry.player.player_name.split(" ").slice(-1)[0]}<small>${entry.role}</small></span>`).join("")}</div>`).join("")}</div>`;
};

const originalRenderProfile = renderProfile;
renderProfile = function enhancedRenderProfile() {
  const club = state.clubs.find((candidate) => candidate.club_id === state.selectedClubId);
  if (!club) return originalRenderProfile();
  originalRenderProfile();
  const panel = document.getElementById("clubProfile");
  panel.querySelectorAll(".squad-table tbody tr").forEach((row, index) => {
    const player = club.squad[index];
    const button = row.querySelector(".player-link");
    if (button && player) button.addEventListener("click", () => { window.location.href = playerProfileHref(player); });
  });

  const age = bucketPlayers(club.squad, [{label:"U21",min:0,max:21},{label:"22–25",min:22,max:25},{label:"26–29",min:26,max:29},{label:"30+",min:30,max:99}], (p) => p.age);
  const rating = bucketPlayers(club.squad, [{label:"90+",min:90,max:100},{label:"87–89",min:87,max:89.99},{label:"84–86",min:84,max:86.99},{label:"Under 84",min:0,max:83.99}], (p) => p.tbg_rating);
  const value = bucketPlayers(club.squad, [{label:"€50m+",min:50e6,max:1e12},{label:"€20–49m",min:20e6,max:49.999e6},{label:"€5–19m",min:5e6,max:19.999e6},{label:"Under €5m",min:0,max:4.999e6}], (p) => p.market_value_eur);
  const charts = document.createElement("section");
  charts.className = "distribution-grid";
  charts.innerHTML = distributionChart("Age distribution", age) + distributionChart("Rating distribution", rating) + distributionChart("Value distribution", value);
  const squadScroll = panel.querySelector(".squad-scroll");
  panel.insertBefore(charts, squadScroll);
};
