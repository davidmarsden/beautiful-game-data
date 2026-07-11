import { readFile, writeFile } from "node:fs/promises";

const path = "data/config/tbg-club-universe.json";
const universe = JSON.parse(await readFile(path, "utf8"));

const swaps = [
  { top80Slot: 71, reserveSlot: 81, promotedName: "Al-Hilal SFC" },
  { top80Slot: 74, reserveSlot: 82, promotedName: "Al-Nassr FC" },
  { top80Slot: 78, reserveSlot: 88, promotedName: "Club América" },
  { top80Slot: 79, reserveSlot: 94, promotedName: "Al Ahly SC" }
];

const bySlot = new Map(universe.clubs.map((club) => [Number(club.slot), club]));
let changed = false;
for (const { top80Slot, reserveSlot, promotedName } of swaps) {
  const top80Club = bySlot.get(top80Slot);
  const reserveClub = bySlot.get(reserveSlot);
  if (!top80Club || !reserveClub) throw new Error(`Missing club slot for swap ${top80Slot} ↔ ${reserveSlot}`);
  if (top80Club.name === promotedName) continue;
  if (reserveClub.name !== promotedName) {
    throw new Error(`Expected ${promotedName} in slot ${reserveSlot}, found ${reserveClub.name}`);
  }
  top80Club.slot = reserveSlot;
  reserveClub.slot = top80Slot;
  bySlot.set(top80Slot, reserveClub);
  bySlot.set(reserveSlot, top80Club);
  changed = true;
}

universe.version = "tbg-club-universe-v0.3";
universe.description = "Canonical playable club universe for The Beautiful Game. Top 80 launch clubs prioritise complete imported squads and global representation; wider reserve clubs remain available for future promotion.";
universe.selection_policy.playable_clubs = 80;
universe.selection_policy.principle = "Choose 80 globally significant clubs with complete playable squads; assign starting divisions by weighted TBG squad strength.";
universe.selection_policy.global_balance_note = "Slots 71, 74, 78 and 79 promote Al-Hilal, Al-Nassr, Club América and Al Ahly in place of incomplete South American imports. The displaced clubs remain in reserve slots.";
universe.clubs.sort((a, b) => Number(a.slot) - Number(b.slot));

await writeFile(path, JSON.stringify(universe, null, 2) + "\n", "utf8");
console.log(changed ? "Promoted global clubs into the Top 80." : "Global Top 80 promotion already applied; no slot changes needed.");
console.log("Top 80 additions: Al-Hilal SFC, Al-Nassr FC, Club América, Al Ahly SC.");
