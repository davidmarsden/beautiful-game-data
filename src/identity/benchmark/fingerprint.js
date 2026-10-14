// Deterministic content fingerprint for benchmark inputs: SHA-256 over rows
// sorted by an id field, each serialised with its keys in sorted order.
// Export metadata and row order do not affect it; any change to row content does.

import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function rowsFingerprint(rows, idField) {
  const sorted = [...rows].sort((a, b) => String(a?.[idField] ?? "").localeCompare(String(b?.[idField] ?? ""), "en", { numeric: true }));
  const hash = createHash("sha256");
  for (const row of sorted) hash.update(canonical(row)).update("\n");
  return hash.digest("hex");
}
