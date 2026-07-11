import { readFile, writeFile } from "node:fs/promises";

const path = "data/config/tbg-club-universe.json";
const universe = JSON.parse(await readFile(path, "utf8"));

const swaps = [
  [71, 81],
  [74, 82],
  [78, 88],
  [79, 94]
];

const bySlot = new Map(universe.clubs.map((club) => [Number(club.slot), club]));
for (const [top80Slot, reserveSlot] of swaps) {
  const top80Club = bySlot.get(top80Slot);
  const reserveClub = bySlot.get(reserveSlot);
  if (!top80Club || !reserveClub) throw new Error(`Missing club slot for swap ${top80Slot} ↔ ${reserveSlot}`);
  top80Club.slot = reserveSlot;
  reserveClub.slot = top80Slot;
}

universe.version = "tbg-club-universe-v0.3";
universe.description = "Canonical playable club universe for The Beautiful Game. Top 80 launch clubs prioritise complete imported squads and global representation; wider reserve clubs remain available for future promotion.";
universe.selection_policy.playable_clubs = 80;
universe.selection_policy.principle = "Choose 80 globally significant clubs with complete playable squads; assign starting divisions by weighted TBG squad strength.";
universe.selection_policy.global_balance_note = "Slots 71, 74, 78 and 79 promote Al-Hilal, Al-Nassr, Club América and Al Ahly in place of incomplete South American imports. The displaced clubs remain in reserve slots.";
universe.clubs.sort((a, b) => Number(a.slot) - Number(b.slot));

await writeFile(path, JSON.stringify(universe, null, 2) + "\n", "utf8");
console.log("Promoted global clubs into Top 80:");
console.log("71 Al-Hilal SFC; 74 Al-Nassr FC; 78 Club América; 79 Al Ahly SC");
console.log("Moved São Paulo FC, Botafogo FR, Racing Club and Independiente to reserve slots.");
