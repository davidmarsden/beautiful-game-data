import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function text(value) {
  return String(value ?? "").trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildCanonicalLeagueRepairPlan(audit, options = {}) {
  const includeMissing = options.includeMissing !== false;
  const includeThin = options.includeThin !== false;
  const thinThreshold = number(options.thinThreshold, 18);
  const selectedLeagueKeys = new Set(
    (options.leagueKeys || []).map(text).filter(Boolean)
  );

  const leagues = (audit.leagues || [])
    .filter((league) => !selectedLeagueKeys.size || selectedLeagueKeys.has(text(league.key)))
    .map((league) => {
      const clubs = (league.club_reports || [])
        .filter((club) => {
          const imported = number(club.imported_players);
          if (includeMissing && imported === 0) return true;
          return includeThin && imported > 0 && imported < thinThreshold;
        })
        .map((club) => ({
          league_key: text(league.key),
          league: text(league.league),
          club_id: text(club.club_id),
          club_name: text(club.club_name),
          imported_players: number(club.imported_players),
          published_players: number(club.published_players),
          target_minimum_players: thinThreshold,
          shortfall: Math.max(0, thinThreshold - number(club.imported_players)),
          reason: number(club.imported_players) === 0 ? "missing" : "thin"
        }))
        .filter((club) => club.club_id);

      return {
        key: text(league.key),
        league: text(league.league),
        clubs
      };
    })
    .filter((league) => league.clubs.length);

  const clubs = leagues.flatMap((league) => league.clubs);
  const clubIds = [...new Set(clubs.map((club) => club.club_id))];

  return {
    generated_at: new Date().toISOString(),
    source_audit_generated_at: audit.generated_at || "",
    season: audit.season || "",
    methodology: "canonical_club_targeted_reimport",
    settings: {
      include_missing: includeMissing,
      include_thin: includeThin,
      thin_threshold: thinThreshold,
      league_keys: [...selectedLeagueKeys]
    },
    summary: {
      leagues: leagues.length,
      clubs: clubs.length,
      missing_clubs: clubs.filter((club) => club.reason === "missing").length,
      thin_clubs: clubs.filter((club) => club.reason === "thin").length,
      estimated_player_shortfall_to_threshold: clubs.reduce((sum, club) => sum + club.shortfall, 0)
    },
    club_ids: clubIds,
    leagues,
    clubs
  };
}

export function renderCanonicalLeagueRepairMarkdown(plan) {
  const lines = [
    "# Canonical League Repair Plan",
    "",
    `Generated: ${plan.generated_at}`,
    `Season: ${plan.season || "unknown"}`,
    "",
    `Target clubs: ${plan.summary.clubs}`,
    `Missing: ${plan.summary.missing_clubs}`,
    `Thin: ${plan.summary.thin_clubs}`,
    `Estimated shortfall to ${plan.settings.thin_threshold} players per club: ${plan.summary.estimated_player_shortfall_to_threshold}`,
    "",
    "## Targeted canonical clubs",
    ""
  ];

  if (!plan.clubs.length) {
    lines.push("No missing or thin canonical clubs require repair.", "");
    return `${lines.join("\n")}\n`;
  }

  for (const league of plan.leagues) {
    lines.push(`### ${league.league}`);
    for (const club of league.clubs) {
      lines.push(`- ${club.club_name} (TM club ${club.club_id}): ${club.imported_players} imported — ${club.reason}, shortfall ${club.shortfall}`);
    }
    lines.push("");
  }

  lines.push("## Targeted fetch", "", `Club IDs: ${plan.club_ids.join(",")}`, "");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const auditPath = args.audit || "reports/league-player-coverage-audit.json";
  const outputPath = args.output || "reports/canonical-league-repair-plan.json";
  const markdownPath = args.markdown || outputPath.replace(/\.json$/i, ".md");
  const leagueKeys = text(args.leagues).split(",").map(text).filter(Boolean);

  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  const plan = buildCanonicalLeagueRepairPlan(audit, {
    includeMissing: args.includeMissing !== "false",
    includeThin: args.includeThin !== "false",
    thinThreshold: number(args.thinThreshold, 18),
    leagueKeys
  });

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(markdownPath, renderCanonicalLeagueRepairMarkdown(plan), "utf8");

  const githubOutput = text(args.githubOutput || process.env.GITHUB_OUTPUT);
  if (githubOutput) {
    await appendFile(githubOutput, [
      `needs_repair=${plan.club_ids.length ? "true" : "false"}`,
      `club_count=${plan.club_ids.length}`,
      `club_ids=${plan.club_ids.join(",")}`,
      `missing_clubs=${plan.summary.missing_clubs}`,
      `thin_clubs=${plan.summary.thin_clubs}`
    ].join("\n") + "\n", "utf8");
  }

  console.log(JSON.stringify(plan.summary, null, 2));
  console.log(`Target club IDs: ${plan.club_ids.join(",") || "none"}`);
  console.log(`Wrote canonical league repair plan: ${outputPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
