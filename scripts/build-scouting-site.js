import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

async function copy(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function applySharedNavigation(path, rootPrefix) {
  const html = await readFile(path, "utf8");
  const nav = `<nav class="nav tbg-nav" aria-label="Pink Final sections"><a href="${rootPrefix}">Front Page</a><a href="${rootPrefix}scouting/">Scouting Database</a><a href="${rootPrefix}clubs/">Clubs</a><a href="${rootPrefix}wonderkids/">Wonderkids</a><a href="${rootPrefix}rankings/">Rankings</a><a href="${rootPrefix}transfer-market/">Transfer Market</a><a href="${rootPrefix}new-this-week/">New This Week</a><a href="${rootPrefix}player-updates/">Player Updates</a><a href="https://thebeautifulgame.online/">Play The Beautiful Game</a></nav>`;
  const updated = html.replace(/<nav class="nav(?: tbg-nav)?"[^>]*>[\s\S]*?<\/nav>/, nav);
  await writeFile(path, updated, "utf8");
}

async function applyDesignContract(path, rootPrefix) {
  const html = await readFile(path, "utf8");
  if (html.includes('tbg-design-contract.css')) return;
  const styles = `<link rel="stylesheet" href="${rootPrefix}tbg-design-contract.css"/><link rel="stylesheet" href="${rootPrefix}pink-final-theme.css"/>`;
  await writeFile(path, html.replace('</head>', `${styles}</head>`), "utf8");
}

const outputDir = "derived/scouting-site";
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await copy("site/tbg-design-contract.css", join(outputDir, "tbg-design-contract.css"));
await copy("public/pink-final-theme.css", join(outputDir, "pink-final-theme.css"));
await copy("public/index.html", join(outputDir, "index.html"));
await copy("public/portal.css", join(outputDir, "portal.css"));
await copy("public/portal.js", join(outputDir, "portal.js"));

await copy("derived/player-database/player-database.json", join(outputDir, "derived", "player-database", "player-database.json"));
await copy("derived/player-database/player-database.csv", join(outputDir, "derived", "player-database", "player-database.csv"));
await copy("derived/player-changes/player-release-history.json", join(outputDir, "derived", "player-changes", "player-release-history.json"));
await copy("derived/player-changes/player-rating-history.json", join(outputDir, "derived", "player-changes", "player-rating-history.json"));

await copy("public/scouting/index.html", join(outputDir, "scouting", "index.html"));
await copy("public/scouting/styles.css", join(outputDir, "scouting", "styles.css"));
await copy("public/scouting/app.js", join(outputDir, "scouting", "app.js"));
await copy("public/scouting/player-links.js", join(outputDir, "scouting", "player-links.js"));
await copy("derived/player-database/player-database.json", join(outputDir, "scouting", "player-database.json"));
await copy("derived/player-database/player-database.csv", join(outputDir, "scouting", "player-database.csv"));

const sections = ["clubs", "players", "wonderkids", "rankings", "transfer-market", "new-this-week", "player-updates"];
for (const section of sections) await copy(`public/${section}/index.html`, join(outputDir, section, "index.html"));
await copy("public/clubs/clubs.css", join(outputDir, "clubs", "clubs.css"));
await copy("public/clubs/clubs.js", join(outputDir, "clubs", "clubs.js"));
await copy("public/clubs/club-enhancements.js", join(outputDir, "clubs", "club-enhancements.js"));
await copy("public/clubs/club-route.js", join(outputDir, "clubs", "club-route.js"));
await copy("public/clubs/club-enhancements.css", join(outputDir, "clubs", "club-enhancements.css"));
await copy("data/config/tbg-club-universe.json", join(outputDir, "clubs", "club-universe.json"));
await copy("public/players/players.css", join(outputDir, "players", "players.css"));
await copy("public/players/players.js", join(outputDir, "players", "players.js"));
await copy("public/wonderkids/wonderkids.css", join(outputDir, "wonderkids", "wonderkids.css"));
await copy("public/wonderkids/wonderkids.js", join(outputDir, "wonderkids", "wonderkids.js"));
await copy("public/rankings/rankings.css", join(outputDir, "rankings", "rankings.css"));
await copy("public/rankings/rankings.js", join(outputDir, "rankings", "rankings.js"));
await copy("public/transfer-market/transfer-market.css", join(outputDir, "transfer-market", "transfer-market.css"));
await copy("public/transfer-market/transfer-market.js", join(outputDir, "transfer-market", "transfer-market.js"));
await copy("public/new-this-week/new-this-week.css", join(outputDir, "new-this-week", "new-this-week.css"));
await copy("public/new-this-week/new-this-week.js", join(outputDir, "new-this-week", "new-this-week.js"));
await copy("derived/player-changes/player-change-ledger.json", join(outputDir, "new-this-week", "player-change-ledger.json"));
await copy("public/player-updates/player-updates.css", join(outputDir, "player-updates", "player-updates.css"));
await copy("public/player-updates/player-updates.js", join(outputDir, "player-updates", "player-updates.js"));

await applySharedNavigation(join(outputDir, "index.html"), "./");
await applyDesignContract(join(outputDir, "index.html"), "./");
for (const section of ["scouting", ...sections]) {
  await applySharedNavigation(join(outputDir, section, "index.html"), "../");
  await applyDesignContract(join(outputDir, section, "index.html"), "../");
}
console.log(`Built Pink Final portal at ${outputDir}`);