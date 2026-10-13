// Adapters from source-shaped rows to the reconciler's input shape, for the
// SM <-> TM identity benchmark. Both deliberately omit club fields:
//   - SM ClubName is the Top 100 game-world club, not the real-world club;
//   - so TM current_club must not be compared against it either.

import { normaliseName } from "../playerIdentityResolver.js";

function text(value) {
  return String(value ?? "").trim();
}

// SM country names that differ from Transfermarkt's nationality labels.
// Only spelling/label differences; no political merging.
export const SM_TO_TM_COUNTRY = new Map([
  ["Turkey", "Türkiye"],
  ["Ivory Coast", "Cote d'Ivoire"],
  ["Korea Republic", "Korea, South"],
  ["Bosnia & Herzegovina", "Bosnia-Herzegovina"],
  ["Republic of Macedonia", "North Macedonia"],
  ["Gambia", "The Gambia"],
  ["Trinidad & Tobago", "Trinidad and Tobago"],
  ["Palestinian Territory", "Palestine"],
  ["Hong Kong", "Hongkong"],
  ["Saint Lucia", "St. Lucia"],
  ["Saint Vincent and the Grenadines", "St. Vincent & Grenadinen"],
  ["Saint Kitts and Nevis", "St. Kitts & Nevis"]
]);

// SM PositionDis is HTML such as <acronym title="Defender Centre">D(C)</acronym>.
// The title holds readable position words the reconciler can group.
export function smPositionTitle(positionDis) {
  const raw = text(positionDis);
  const match = raw.match(/title="([^"]*)"/);
  if (match) return match[1];
  return raw.replace(/<[^>]*>/g, " ").trim();
}

export function ageBand(age) {
  if (!Number.isFinite(age)) return "unknown";
  if (age <= 20) return "u21";
  if (age <= 27) return "21-27";
  if (age <= 32) return "28-32";
  return "33+";
}

export function ratingBand(rating) {
  if (!Number.isFinite(rating)) return "unknown";
  if (rating >= 85) return "85+";
  if (rating >= 80) return "80-84";
  if (rating >= 70) return "70-79";
  return "<70";
}

// Minimal SM benchmark row (as exported from Manager Lab) -> reconciler row.
// SM conventions:
//   - PlayerSurname often carries the football name for Brazilian/Portuguese
//     players ("Ferreira VITINHA", "Becker ALISSON"), so the surname alone is
//     an alias;
//   - PlayerName is an initial plus surname ("H.KANE"), comparable with TM short_name.
export function smToMatcherRow(row) {
  const forename = text(row.forename);
  const surname = text(row.surname);
  const country = text(row.country);
  const age = Number.parseInt(row.age, 10);
  return {
    player_data_id: text(row.player_data_id),
    name: [forename, surname].filter(Boolean).join(" "),
    short_name: text(row.player_name).replace(/\./g, " "),
    aliases: forename && surname ? [surname] : [],
    nationality: country ? [SM_TO_TM_COUNTRY.get(country) ?? country] : [],
    position: smPositionTitle(row.position_dis ?? row.position_title),
    age: Number.isFinite(age) ? age : null,
    // Verified SM dates of birth exist only for a few players (profile captures);
    // when present they let the reconciler's exact-DOB path run as a control.
    date_of_birth: text(row.date_of_birth),
    // Date the SM row was observed; SM Age is exact on this date.
    observed_date: text(row.observed_at).slice(0, 10),
    rating_band: text(row.rating_band) || "unknown"
  };
}

// TM master row -> reconciler row. Club fields are dropped on purpose.
export function tmToMatcherRow(row) {
  return {
    transfermarkt_id: text(row.transfermarkt_id || row.player_id),
    tbg_player_id: text(row.tbg_player_id),
    full_name: text(row.full_name),
    display_name: text(row.display_name),
    short_name: text(row.short_name),
    nickname: text(row.nickname),
    nationality: Array.isArray(row.nationality) ? row.nationality : [row.nationality].filter(Boolean),
    position: text(row.position),
    date_of_birth: text(row.date_of_birth)
  };
}

// Age in whole years on a reference date, from an ISO date of birth.
export function ageOn(dateOfBirth, referenceDate) {
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(text(dateOfBirth)) ? dateOfBirth : "";
  const ref = text(referenceDate).slice(0, 10);
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(ref)) return null;
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ry, rm, rd] = ref.split("-").map(Number);
  let age = ry - by;
  if (rm < bm || (rm === bm && rd < bd)) age -= 1;
  return age;
}

// Which SM name variant produced a candidate's name match.
export function smVariantType(smRow, matchedSmText) {
  const key = normaliseName(matchedSmText);
  if (!key) return "none";
  if (key === normaliseName(smRow.name)) return "forename_surname";
  if (smRow.aliases.some(alias => normaliseName(alias) === key)) return "surname_only";
  if (key === normaliseName(smRow.short_name)) return "initial_surname";
  return "other";
}

const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{M}]*$/u;
export function isNonLatin(value) {
  const v = text(value);
  return Boolean(v) && !LATIN.test(v);
}
