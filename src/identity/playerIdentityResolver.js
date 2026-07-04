function stripAccents(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[ø]/g, "o")
    .replace(/[Ø]/g, "O")
    .replace(/[æ]/g, "ae")
    .replace(/[Æ]/g, "AE")
    .replace(/[ß]/g, "ss");
}

export function normaliseName(value) {
  return stripAccents(value)
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

const SOCCERWIKI_NAME_ALIASES = new Map([
  ["hernandez rodri", ["rodri", "rodrigo hernandez"]],
  ["becker alisson", ["alisson", "alisson becker"]],
  ["andrade richarlison", ["richarlison", "richarlison de andrade"]],
  ["carlos casemiro", ["casemiro", "carlos henrique casemiro"]],
  ["cassio joelinton", ["joelinton", "joelinton cassio"]],
  ["barbosa evanilson", ["evanilson", "evanilson barbosa"]],
  ["moreira savinho", ["savinho", "savio", "savio moreira", "savio moreira de oliveira"]],
  ["gomes beto", ["beto", "norberto betuncal", "norberto neto"]],
  ["ferdi kadioglu", ["ferdi kadioglu", "ferdi kadıoglu", "ferdi kadıoğlu"]],
  ["andre onana", ["andre onana", "andré onana"]],
  ["kostas tsimikas", ["konstantinos tsimikas", "kostas tsimikas"]],
  ["vitor rayan", ["rayan vitor", "vitor roque", "rayan"]],
  ["yehor yarmolyuk", ["yegor yarmolyuk", "yehor yarmoliuk", "egor yarmolyuk"]],
  ["felipe morato", ["morato", "felipe rodrigues da silva"]],
  ["odysseas vlachodimos", ["odisseas vlachodimos", "odysseas vlachodimos"]]
]);

function compactId(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function words(value) {
  return normaliseName(value).split(/\s+/).filter(Boolean);
}

function surnameKey(value) {
  const parts = words(value);
  return parts.length ? parts[parts.length - 1] : "";
}

function tokenSet(value) {
  return new Set(words(value));
}

function jaccard(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

function dateYear(date) {
  const match = String(date ?? "").match(/^(\d{4})/);
  return match ? match[1] : "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function aliasKeysForKey(key) {
  const aliases = SOCCERWIKI_NAME_ALIASES.get(key) ?? [];
  return aliases.map(normaliseName).filter(Boolean);
}

function derivedNameKeys(key) {
  const parts = words(key);
  const variants = [key, ...aliasKeysForKey(key)];

  if (parts.length >= 2) {
    variants.push([...parts].reverse().join(" "));
    variants.push(parts[parts.length - 1]);
  }

  if (parts.length >= 3) {
    variants.push(parts.slice(1).join(" "));
    variants.push(parts.slice(-2).join(" "));
  }

  return unique(variants.map(normaliseName));
}

function allNameKeys(row) {
  return unique([
    row.name_key,
    row.full_name_key,
    normaliseName(row.canonical_name),
    normaliseName(row.display_name),
    normaliseName(row.full_name),
    ...(row.alias_keys ?? []),
    ...(row.aliases ?? []).map(normaliseName)
  ].filter(Boolean));
}

function pushIndex(map, key, row) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(row);
}

function buildIndexes(registryRows) {
  const indexes = {
    byTbgId: new Map(),
    byTransfermarktId: new Map(),
    bySoccerwikiId: new Map(),
    byApiFootballId: new Map(),
    byNameKey: new Map(),
    bySurname: new Map(),
    byNameDob: new Map()
  };

  for (const row of registryRows) {
    const tbgId = compactId(row.tbg_player_id);
    const transfermarktId = compactId(row.transfermarkt_id);
    const soccerwikiId = compactId(row.soccerwiki_id);
    const apiFootballId = compactId(row.api_football_id);
    if (tbgId) indexes.byTbgId.set(tbgId, row);
    if (transfermarktId) indexes.byTransfermarktId.set(transfermarktId, row);
    if (soccerwikiId) indexes.bySoccerwikiId.set(soccerwikiId, row);
    if (apiFootballId) indexes.byApiFootballId.set(apiFootballId, row);

    for (const key of allNameKeys(row)) {
      pushIndex(indexes.byNameKey, key, row);
      if (row.date_of_birth) pushIndex(indexes.byNameDob, `${key}|${row.date_of_birth}`, row);
      if (dateYear(row.date_of_birth)) pushIndex(indexes.byNameDob, `${key}|${dateYear(row.date_of_birth)}`, row);
      pushIndex(indexes.bySurname, surnameKey(key), row);
    }
  }

  return indexes;
}

function result(row, method, confidence, reasons = []) {
  return {
    matched: Boolean(row),
    confidence,
    method,
    tbg_player_id: row?.tbg_player_id ?? "",
    transfermarkt_id: row?.transfermarkt_id ?? "",
    soccerwiki_id: row?.soccerwiki_id ?? "",
    api_football_id: row?.api_football_id ?? "",
    canonical_name: row?.canonical_name ?? "",
    current_club: row?.current_club ?? "",
    position: row?.primary_position ?? "",
    date_of_birth: row?.date_of_birth ?? "",
    reasons
  };
}

function ambiguous(rows, method, confidence, reasons = []) {
  return {
    matched: false,
    ambiguous: true,
    confidence,
    method,
    candidates: rows.slice(0, 10).map((row) => ({
      tbg_player_id: row.tbg_player_id,
      transfermarkt_id: row.transfermarkt_id,
      canonical_name: row.canonical_name,
      current_club: row.current_club,
      position: row.primary_position,
      date_of_birth: row.date_of_birth
    })),
    reasons
  };
}

function pickUnique(rows, method, confidence, reasons) {
  const uniqueRows = [...new Map(rows.map((row) => [row.tbg_player_id, row])).values()];
  if (uniqueRows.length === 1) return result(uniqueRows[0], method, confidence, reasons);
  if (uniqueRows.length > 1) return ambiguous(uniqueRows, method, confidence, reasons);
  return null;
}

function queryNameKeys(query) {
  const baseKeys = [
    query.name_key,
    query.full_name_key,
    query.name,
    query.player_name,
    query.playerName,
    query.full_name,
    query.display_name
  ].map(normaliseName).filter(Boolean);

  return unique(baseKeys.flatMap(derivedNameKeys));
}

function bestNameFallback(indexes, query) {
  const keys = queryNameKeys(query);
  if (!keys.length) return null;

  const candidateMap = new Map();
  for (const key of keys) {
    for (const row of indexes.bySurname.get(surnameKey(key)) ?? []) {
      candidateMap.set(row.tbg_player_id, row);
    }
  }

  const candidates = [...candidateMap.values()].map((row) => {
    const scores = [];
    for (const key of keys) {
      for (const rowKey of allNameKeys(row)) scores.push(jaccard(key, rowKey));
    }
    let score = scores.length ? Math.max(...scores) : 0;
    const queryDob = query.date_of_birth || query.dob || "";
    if (queryDob && row.date_of_birth === queryDob) score += 0.25;
    else if (queryDob && dateYear(queryDob) && dateYear(queryDob) === dateYear(row.date_of_birth)) score += 0.1;
    const queryPosition = normaliseName(query.position || query.primary_position || "");
    if (queryPosition && normaliseName(row.primary_position).includes(queryPosition)) score += 0.05;
    return { row, score };
  }).filter((item) => item.score >= 0.62).sort((a, b) => b.score - a.score);

  if (!candidates.length) return null;
  const best = candidates[0];
  const tied = candidates.filter((item) => Math.abs(item.score - best.score) < 0.03).map((item) => item.row);
  if (tied.length > 1) return ambiguous(tied, "name_fallback", Math.min(best.score, 0.84), ["multiple close name candidates"]);
  return result(best.row, "name_fallback", Math.min(best.score, 0.84), [`best token similarity ${best.score.toFixed(3)}`]);
}

export function createPlayerIdentityResolver(registryRows) {
  const indexes = buildIndexes(registryRows);

  function resolve(query = {}) {
    const transfermarktId = compactId(query.transfermarkt_id ?? query.player_id ?? query.tm_id);
    if (transfermarktId && indexes.byTransfermarktId.has(transfermarktId)) {
      return result(indexes.byTransfermarktId.get(transfermarktId), "transfermarkt_id", 1, ["exact Transfermarkt ID"]);
    }

    const tbgId = compactId(query.tbg_player_id ?? query.tbg_id);
    if (tbgId && indexes.byTbgId.has(tbgId)) return result(indexes.byTbgId.get(tbgId), "tbg_player_id", 1, ["exact TBG player ID"]);

    const soccerwikiId = compactId(query.soccerwiki_id ?? query.sw_id);
    if (soccerwikiId && indexes.bySoccerwikiId.has(soccerwikiId)) return result(indexes.bySoccerwikiId.get(soccerwikiId), "soccerwiki_id", 1, ["exact SoccerWiki ID"]);

    const apiFootballId = compactId(query.api_football_id ?? query.api_id);
    if (apiFootballId && indexes.byApiFootballId.has(apiFootballId)) return result(indexes.byApiFootballId.get(apiFootballId), "api_football_id", 1, ["exact API-Football ID"]);

    for (const key of queryNameKeys(query)) {
      const dob = query.date_of_birth || query.dob || "";
      if (dob) {
        const exactDob = pickUnique(indexes.byNameDob.get(`${key}|${dob}`) ?? [], "name_and_dob", 0.98, ["exact name key and DOB"]);
        if (exactDob) return exactDob;
        const yearDob = dateYear(dob) ? pickUnique(indexes.byNameDob.get(`${key}|${dateYear(dob)}`) ?? [], "name_and_birth_year", 0.93, ["exact name key and birth year"]) : null;
        if (yearDob) return yearDob;
      }

      const exactName = pickUnique(indexes.byNameKey.get(key) ?? [], "name_key", 0.9, ["exact canonical/alias name key"]);
      if (exactName) return exactName;
    }

    return bestNameFallback(indexes, query) ?? {
      matched: false,
      ambiguous: false,
      confidence: 0,
      method: "none",
      reasons: ["no identity match"]
    };
  }

  return { resolve, indexes };
}
