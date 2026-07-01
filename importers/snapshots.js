export function createDataSnapshot(input) {
  const provider = input.provider;
  const version = input.version;
  const rows = input.rows;

  if (!provider) throw new Error("Data provider is required.");
  if (!version) throw new Error("Data version is required.");
  if (!Array.isArray(rows)) throw new Error("Data rows must be an array.");

  return {
    meta: {
      provider,
      version,
      source: input.source ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
      rowCount: rows.length
    },
    rows
  };
}
