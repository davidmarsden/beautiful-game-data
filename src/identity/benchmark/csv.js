// Minimal RFC 4180 CSV read/write for benchmark adjudication sheets.

function quote(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns = rows.length ? Object.keys(rows[0]) : []) {
  const lines = [columns.map(quote).join(",")];
  for (const row of rows) lines.push(columns.map(column => quote(row[column])).join(","));
  return lines.join("\n") + "\n";
}

export function parseCsv(text) {
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { record.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field); records.push(record); record = []; field = "";
    } else field += ch;
  }
  if (field !== "" || record.length) { record.push(field); records.push(record); }
  const [header = [], ...body] = records.filter(r => r.length > 1 || r[0] !== "");
  return body.map(r => Object.fromEntries(header.map((column, i) => [column, r[i] ?? ""])));
}
