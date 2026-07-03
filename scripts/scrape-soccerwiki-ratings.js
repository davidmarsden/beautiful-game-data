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

function soccerWikiLeagueUrls({ leagueId, pages = 1, pageSize = 15, baseUrl = "https://en.soccerwiki.org/search/player" }) {
  return Array.from({ length: Number(pages) }, (_, index) => {
    const offset = index * Number(pageSize);
    const url = new URL(baseUrl);
    url.searchParams.set("leagueid", String(leagueId));
    if (offset > 0) url.searchParams.set("offset", String(offset));
    return url.toString();
  });
}

function parseUrls(args) {
  if (args.urls) return String(args.urls).split(",").map((url) => url.trim()).filter(Boolean);
  if (args.url) return [String(args.url).trim()];
  if (args.leagueId) {
    return soccerWikiLeagueUrls({
      leagueId: args.leagueId,
      pages: args.pages ?? 1,
      pageSize: args.pageSize ?? 15,
      baseUrl: args.baseUrl
    });
  }
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
  console.log(`Scraping ${urls.length} SoccerWiki URL(s).`);
  rows = await scrapeSoccerWikiRatings(urls, {
    delayMs: args.delayMs ? Number(args.delayMs) : 1000,
    userAgent: args.userAgent
  });
} else {
  console.error("Usage: node scripts/scrape-soccerwiki-ratings.js --url=<url> OR --urls=<url1,url2> OR --leagueId=<id> --pages=<n> OR --html=<saved-page.html> [--output=calibration/smw-ratings.csv]");
  process.exit(1);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, ratingsToCsv(rows), "utf8");

console.log(`Wrote ${rows.length} SoccerWiki ratings to ${output}`);
if (rows.length) {
  console.log(`Top sample: ${rows.slice(0, 5).map((row) => `${row.name} ${row.smwRating}`).join(", ")}`);
}

export { soccerWikiLeagueUrls };
