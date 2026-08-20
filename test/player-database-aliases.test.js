import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runExport(players) {
  const dir = await mkdtemp(join(tmpdir(), "tbg-player-aliases-"));
  const globalPlayers = join(dir, "global.json");
  const outputJson = join(dir, "player-database.json");
  const outputCsv = join(dir, "player-database.csv");
  const summary = join(dir, "summary.json");
  await writeFile(globalPlayers, JSON.stringify(players), "utf8");

  await execFileAsync(process.execPath, [
    "scripts/export-player-database.js",
    `--globalPlayers=${globalPlayers}`,
    `--gamePlayers=${join(dir, "missing-game.json")}`,
    `--unsignedPlayers=${join(dir, "missing-unsigned.json")}`,
    `--outputJson=${outputJson}`,
    `--outputCsv=${outputCsv}`,
    `--summary=${summary}`
  ]);

  return {
    rows: JSON.parse(await readFile(outputJson, "utf8")),
    summary: JSON.parse(await readFile(summary, "utf8"))
  };
}

test("published player database preserves governed aliases and derives Transfermarkt profile nickname", async () => {
  const { rows, summary } = await runExport([{
    tbg_player_id: "tbg-tm-01364573",
    transfermarkt_id: "1364573",
    display_name: "Victor Hugo Custódio de Melo Moura",
    full_name: "Victor Hugo Custódio de Melo Moura",
    nickname: "Huguinho",
    profile_url: "https://www.transfermarkt.com/huguinho/profil/spieler/1364573",
    age: 19,
    market_value_eur: 300000,
    tbg_rating: 82
  }]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].player_name, "Victor Hugo Custódio de Melo Moura");
  assert.equal(rows[0].profile_url, "https://www.transfermarkt.com/huguinho/profil/spieler/1364573");
  assert.deepEqual(rows[0].aliases, ["Huguinho"]);
  assert.equal(summary.players_with_aliases, 1);
});

test("profile slug alone supplies a search alias and malformed slugs are ignored", async () => {
  const { rows } = await runExport([
    {
      tbg_player_id: "tbg-tm-01364573",
      transfermarkt_id: "1364573",
      display_name: "Victor Hugo Custódio de Melo Moura",
      profile_url: "https://www.transfermarkt.com/huguinho/profil/spieler/1364573",
      tbg_rating: 82
    },
    {
      tbg_player_id: "tbg-tm-00000001",
      transfermarkt_id: "1",
      display_name: "Broken Slug",
      profile_url: "https://www.transfermarkt.com/%ZZ/profil/spieler/1",
      tbg_rating: 70
    }
  ]);

  const huguinho = rows.find((row) => row.transfermarkt_id === "1364573");
  const broken = rows.find((row) => row.transfermarkt_id === "1");
  assert.deepEqual(huguinho.aliases, ["huguinho"]);
  assert.deepEqual(broken.aliases, []);
});

test("normal rebuild carries governed alias fields through the player-pool export", async () => {
  const pools = await readFile("scripts/export-tbg-player-pools.js", "utf8");
  assert.match(pools, /function aliasValues/);
  assert.match(pools, /tmRow\.aliases/);
  assert.match(pools, /tmRow\.nickname/);
  assert.match(pools, /tmRow\.short_name/);
  assert.match(pools, /profileRow\?\.aliases/);
  assert.match(pools, /ratingRow\?\.aliases/);
  assert.match(pools, /short_name:/);
  assert.match(pools, /aliases,/);
  assert.match(pools, /nickname:/);
  assert.match(pools, /"aliases"/);
});
