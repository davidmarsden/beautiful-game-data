import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSoccerWikiRatingsHtml, ratingsToCsv, scrapeSoccerWikiRatings } from "../src/soccerwiki/scrapeRatings.js";

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value ?? true;
  }
  return args;
}

function parseUrls(args) {
  if (args.urls) return String(args.urls).split(",").map((url) => url.trim()).filter(Boolean);
  if (args.url) return [String(args.url).trim()];
  return [];
}

async function loadFromHtmlFile(path) {
  const html = await readFile(path, "utf8");
  return parseSoccerWikiRatingsHtml(html);
}

const args = parseArgs(process.argv.slice(2));
const output = args.output ?? "calibration/smw-ratings.csv";
const urls = parseUrls(args);
let rows = [];

if (args.html) {
  rows = await loadFromHtmlFile(args.html);
} else if (urls.length) {
  rows = await scrapeSoccerWikiRatings(urls, {
    delayMs: args.delayMs ? Number(args.delayMs) : 1000,
    userAgent: args.userAgent
  });
} else {
  console.error("Usage: node scripts/scrape-soccerwiki-ratings.js --url=<url> OR --urls=<url1,url2> OR --html=<saved-page.html> [--output=calibration/smw-ratings.csv]");
  process.exit(1);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, ratingsToCsv(rows), "utf8");

console.log(`Wrote ${rows.length} SoccerWiki ratings to ${output}`);
if (rows.length) {
  console.log(`Top sample: ${rows.slice(0, 5).map((row) => `${row.name} ${row.smwRating}`).join(", ")}`);
}
