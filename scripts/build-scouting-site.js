import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

async function copy(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

const outputDir = "derived/scouting-site";
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await copy("public/scouting/index.html", join(outputDir, "index.html"));
await copy("public/scouting/styles.css", join(outputDir, "styles.css"));
await copy("public/scouting/app.js", join(outputDir, "app.js"));
await copy("derived/player-database/player-database.json", join(outputDir, "player-database.json"));
await copy("derived/player-database/player-database.csv", join(outputDir, "player-database.csv"));

console.log(`Built scouting site at ${outputDir}`);
