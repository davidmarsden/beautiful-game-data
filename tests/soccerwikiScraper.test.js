import test from "node:test";
import assert from "node:assert/strict";
import { parseSoccerWikiRatingsHtml, ratingsToCsv } from "../src/soccerwiki/scrapeRatings.js";

const sampleHtml = `
<table>
  <tr><th>Player</th><th>Club</th><th>Age</th><th>Pos</th><th>Rt</th></tr>
  <tr>
    <td><a href="/player/mohamed-salah">Mohamed Salah</a></td>
    <td><a href="/club/liverpool">Liverpool</a></td>
    <td>33</td>
    <td>AM(R),F(C)</td>
    <td>94</td>
  </tr>
  <tr>
    <td><a href="/player/bukayo-saka">Bukayo Saka</a></td>
    <td><a href="/club/arsenal">Arsenal</a></td>
    <td>24</td>
    <td>AM(RL)</td>
    <td>94</td>
  </tr>
</table>
`;

test("parses SoccerWiki rating table HTML", () => {
  const rows = parseSoccerWikiRatingsHtml(sampleHtml);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Mohamed Salah");
  assert.equal(rows[0].club, "Liverpool");
  assert.equal(rows[0].smwRating, 94);
  assert.equal(rows[0].age, 33);
});

test("writes SoccerWiki ratings CSV", () => {
  const rows = parseSoccerWikiRatingsHtml(sampleHtml);
  const csv = ratingsToCsv(rows);

  assert.match(csv, /name,club,smwRating,position,age,soccerwikiUrl/);
  assert.match(csv, /Mohamed Salah,Liverpool,94/);
  assert.match(csv, /Bukayo Saka,Arsenal,94/);
});
