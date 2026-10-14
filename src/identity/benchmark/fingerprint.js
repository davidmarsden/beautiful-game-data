// Deterministic content fingerprint for benchmark inputs: each row is
// serialised with its keys in sorted order, the serialised rows are sorted,
// and SHA-256 is taken over the result. Export metadata and row order (including
// the order of duplicate or equal-looking IDs) do not affect it; any change to
// row content does.

import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function rowsFingerprint(rows) {
  const lines = rows.map(canonical).sort(); // plain code-unit order: total and locale-free
  const hash = createHash("sha256");
  for (const line of lines) hash.update(line).update("\n");
  return hash.digest("hex");
}
