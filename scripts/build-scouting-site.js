import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

async function copy(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

const outputDir = "derived/scouting-site";
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await copy("public/index.html", join(outputDir, "index.html"));
await copy("public/portal.css", join(outputDir, "portal.css"));
await copy("public/portal.js", join(outputDir, "portal.js"));

await copy("public/scouting/index.html", join(outputDir, "scouting", "index.html"));
await copy("public/scouting/styles.css", join(outputDir, "scouting", "styles.css"));
await copy("public/scouting/app.js", join(outputDir, "scouting", "app.js"));
await copy("derived/player-database/player-database.json", join(outputDir, "scouting", "player-database.json"));
await copy("derived/player-database/player-database.csv", join(outputDir, "scouting", "player-database.csv"));

await copy("public/clubs/index.html", join(outputDir, "clubs", "index.html"));
await copy("public/clubs/clubs.css", join(outputDir, "clubs", "clubs.css"));
await copy("public/clubs/clubs.js", join(outputDir, "clubs", "clubs.js"));
await copy("data/config/tbg-club-universe.json", join(outputDir, "clubs", "club-universe.json"));

console.log(`Built Pink Final portal at ${outputDir}`);
