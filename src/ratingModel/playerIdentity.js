const CLUB_ALIASES = new Map([
  ["manchester utd", "manchester united"],
  ["man utd", "manchester united"],
  ["man united", "manchester united"],
  ["brighton", "brighton hove albion"],
  ["brighton hove", "brighton hove albion"],
  ["brighton hove albion", "brighton hove albion"],
  ["tottenham", "tottenham hotspur"],
  ["spurs", "tottenham hotspur"],
  ["afc bournemouth", "bournemouth"],
  ["bournemouth", "bournemouth"],
  ["newcastle", "newcastle united"],
  ["west ham", "west ham united"],
  ["wolves", "wolverhampton wanderers"],
  ["wolverhampton", "wolverhampton wanderers"],
  ["leeds", "leeds united"]
]);

const NAME_ALIASES = new Map([
  ["thiago", "igor thiago"],
  ["beto", "gomes beto"],
  ["evanilson", "barbosa evanilson"],
  ["richarlison", "andrade richarlison"],
  ["rodri", "hernandez rodri"],
  ["m odegaard", "martin odegaard"],
  ["martin odegaard", "martin odegaard"],
  ["f kadioglu", "ferdi kadioglu"],
  ["d petrovic", "djordje petrovic"],
  ["rayan", "vitor rayan"],
  ["savinho", "moreira savinho"]
]);

export function normaliseText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normaliseName(value) {
  const clean = normaliseText(value)
    .replace(/\b(fc|afc|cf|sc|sk|calcio|club)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return NAME_ALIASES.get(clean) ?? clean;
}

export function normaliseClub(value) {
  const clean = normaliseText(value)
    .replace(/\b(fc|afc|cf|sc|sk|calcio|club)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return CLUB_ALIASES.get(clean) ?? clean;
}

function compactName(value) {
  return normaliseName(value).replace(/\s+/g, "");
}

function nameTokens(value) {
  return normaliseName(value).split(/\s+/).filter(Boolean);
}

function nameParts(value) {
  const tokens = nameTokens(value);
  const first = tokens[0] ?? "";
  const last = tokens.at(-1) ?? "";
  const initial = first ? first[0] : "";
  return { tokens, first, last, initial };
}

export function isInitialSurnameMatch(a, b) {
  const left = nameParts(a);
  const right = nameParts(b);
  return Boolean(left.last && right.last && left.last === right.last && left.initial && right.initial && left.initial === right.initial);
}

function hasSameTokenSet(a, b) {
  const left = nameTokens(a).sort().join("|");
  const right = nameTokens(b).sort().join("|");
  return Boolean(left && left === right);
}

export function nameSimilarity(a, b) {
  const normalA = normaliseName(a);
  const normalB = normaliseName(b);
  if (!normalA || !normalB) return 0;
  if (normalA === normalB) return 1;
  if (compactName(a) === compactName(b)) return 1;
  if (hasSameTokenSet(a, b)) return 0.99;
  if (isInitialSurnameMatch(a, b)) return 0.98;

  const aTokens = new Set(nameTokens(a));
  const bTokens = new Set(nameTokens(b));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = intersection / union;
  const lastA = [...aTokens].at(-1);
  const lastB = [...bTokens].at(-1);
  const lastScore = lastA && lastA === lastB ? 0.25 : 0;
  return Math.min(1, tokenScore + lastScore);
}

export function clubSimilarity(a, b) {
  if (!a || !b) return 0;
  const normalA = normaliseClub(a);
  const normalB = normaliseClub(b);
  if (normalA === normalB) return 1;
  if (normalA.includes(normalB) || normalB.includes(normalA)) return 0.8;
  return nameSimilarity(normalA, normalB);
}

export function playerIdentityKey(name) {
  return normaliseName(name);
}

export function playerClubKey(name, club = "") {
  const nameKey = playerIdentityKey(name);
  const clubKey = normaliseClub(club);
  return clubKey ? `${nameKey}|${clubKey}` : nameKey;
}

export function confidenceLabel(confidence) {
  if (confidence >= 0.995) return "exact-name";
  if (confidence >= 0.985) return "canonical-or-reordered-name";
  if (confidence >= 0.975) return "initial-surname";
  if (confidence >= 0.95) return "strong-name";
  if (confidence >= 0.85) return "club-tiebreak";
  return "review";
}

export function matchIdentity(source, targets, options = {}) {
  const sourceName = source.name ?? source.playerName ?? "";
  const sourceClub = source.club ?? source.clubName ?? source.teamName ?? "";
  const minConfidence = Number(options.minConfidence ?? 0.95);
  const clubTieBreakConfidence = Number(options.clubTieBreakConfidence ?? 0.85);

  const candidates = (targets ?? [])
    .map((target) => {
      const targetName = target.name ?? target.playerName ?? "";
      const targetClub = target.club ?? target.clubName ?? target.teamName ?? "";
      const nameScore = nameSimilarity(sourceName, targetName);
      const clubScore = clubSimilarity(sourceClub, targetClub);
      const sameClub = clubScore >= 0.8;
      let confidence = nameScore;
      let reason = confidenceLabel(confidence);

      if (nameScore >= 0.80 && sameClub && confidence < clubTieBreakConfidence) {
        confidence = clubTieBreakConfidence;
        reason = "club-tiebreak";
      }

      return {
        ...target,
        confidence: Number(confidence.toFixed(3)),
        reason,
        nameScore: Number(nameScore.toFixed(3)),
        clubScore: Number(clubScore.toFixed(3)),
        clubMismatch: Boolean(sourceClub && targetClub && clubScore < 0.8)
      };
    })
    .filter((candidate) => candidate.nameScore >= 0.35 || candidate.confidence >= 0.8)
    .sort((a, b) => b.confidence - a.confidence || b.nameScore - a.nameScore || b.clubScore - a.clubScore || String(a.name).localeCompare(String(b.name)));

  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  if (!best) return { match: null, candidates };

  const clearlyBest = !second || best.confidence - second.confidence >= 0.03 || (best.confidence >= 0.98 && second.confidence < best.confidence);
  if (best.confidence >= minConfidence && clearlyBest) return { match: best, candidates };
  return { match: null, candidates };
}
