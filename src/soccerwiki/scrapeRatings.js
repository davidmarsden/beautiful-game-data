function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]*>/g, " "));
}

function cellsFromRow(rowHtml) {
  const cells = [];
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let match;
  while ((match = cellRegex.exec(rowHtml)) !== null) {
    cells.push(stripTags(match[1]));
  }
  return cells;
}

function linksFromRow(rowHtml) {
  const links = [];
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(rowHtml)) !== null) {
    links.push({ href: match[1], text: stripTags(match[2]) });
  }
  return links;
}

function looksLikeRating(value) {
  const rating = Number(String(value ?? "").match(/\b(5\d|6\d|7\d|8\d|9\d)\b/)?.[1]);
  return Number.isFinite(rating) ? rating : null;
}

function pickRating(cells) {
  const ratings = cells.map(looksLikeRating).filter((value) => value !== null);
  return ratings.length ? Math.max(...ratings) : null;
}

function pickAge(cells) {
  for (const cell of cells) {
    const value = Number(String(cell).match(/\b(1[5-9]|[2-3]\d|4[0-5])\b/)?.[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function pickPosition(cells) {
  const positions = ["GK", "D", "DM", "M", "AM", "F", "A", "Defender", "Midfielder", "Forward", "Goalkeeper"];
  for (const cell of cells) {
    const clean = String(cell).trim();
    if (positions.some((position) => clean === position || clean.includes(position))) return clean;
  }
  return null;
}

function pickNameAndClub(rowHtml, cells) {
  const links = linksFromRow(rowHtml).filter((link) => link.text);
  const playerLink = links.find((link) => /player/i.test(link.href)) ?? links[0];
  const clubLink = links.find((link) => /club|team/i.test(link.href) && link.text !== playerLink?.text) ?? links.find((link) => link.text !== playerLink?.text);

  return {
    name: playerLink?.text ?? cells.find((cell) => /[a-z]/i.test(cell)) ?? null,
    club: clubLink?.text ?? null,
    soccerwikiUrl: playerLink?.href ?? null
  };
}

function rowToPlayer(rowHtml) {
  const cells = cellsFromRow(rowHtml);
  if (cells.length < 2) return null;

  const rating = pickRating(cells);
  if (!rating) return null;

  const identity = pickNameAndClub(rowHtml, cells);
  if (!identity.name) return null;

  return {
    name: identity.name,
    club: identity.club,
    smwRating: rating,
    position: pickPosition(cells),
    age: pickAge(cells),
    soccerwikiUrl: identity.soccerwikiUrl
  };
}

export function parseSoccerWikiRatingsHtml(html) {
  const rows = [];
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const player = rowToPlayer(match[1]);
    if (player) rows.push(player);
  }

  return rows;
}

function csvValue(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function ratingsToCsv(rows) {
  const headers = ["name", "club", "smwRating", "position", "age", "soccerwikiUrl"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvValue(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export async function fetchSoccerWikiRatingsPage(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "user-agent": options.userAgent ?? "BeautifulGameBot/0.1 (+https://github.com/davidmarsden/beautiful-game-data)",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) {
    throw new Error(`SoccerWiki request failed ${response.status}: ${url}`);
  }

  return response.text();
}

function uniqueRows(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = `${String(row.name).toLowerCase()}|${String(row.club ?? "").toLowerCase()}|${row.smwRating}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

export async function scrapeSoccerWikiRatings(urls, options = {}) {
  const rows = [];
  for (const url of urls) {
    const html = await fetchSoccerWikiRatingsPage(url, options);
    rows.push(...parseSoccerWikiRatingsHtml(html));
    const delayMs = Number(options.delayMs ?? 1000);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return uniqueRows(rows).sort((a, b) => b.smwRating - a.smwRating || a.name.localeCompare(b.name));
}
