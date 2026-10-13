#!/usr/bin/env node
// Runs the SM <-> TM identity benchmark. Read-only; writes only to --out.
//
//   node scripts/identity-benchmark.js run \
//     --sm <sm-benchmark-rows.json> --tm data/transfermarkt/players-master.json \
//     --out <dir> [--seed <text>]
//   node scripts/identity-benchmark.js evaluate --dir <dir> \
//     [--tm-gold <adjudicated-tm.csv>] [--sm-gold <adjudicated-sm.csv>]
//
// The SM input is the minimal export written by Manager Lab's
// export_identity_benchmark_rows.py. Every file in --out except summary.* holds
// private SM data and must not be committed to this public repository.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { runIdentityBenchmark } from "../src/identity/benchmark/runIdentityBenchmark.js";
import { evaluateTmGold, evaluateSmGold } from "../src/identity/benchmark/evaluateGold.js";
import { toCsv, parseCsv } from "../src/identity/benchmark/csv.js";

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1], i += 1;
    else out._.push(argv[i]);
  }
  return out;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function gitCommit() {
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return null; }
}

function summaryMarkdown(summary) {
  const lines = [];
  const s = summary.sm_side;
  lines.push(`# SM ↔ TM identity benchmark`);
  lines.push("");
  lines.push(`Snapshot \`${summary.snapshot_id}\` (${summary.snapshot_date}) · ${summary.benchmark_version} · ${summary.algorithm_version}`);
  lines.push(`Inputs: ${summary.inputs.sm_rows} SM rows, ${summary.inputs.tm_rows} TM rows.`);
  lines.push("");
  const f = summary.structural_findings;
  lines.push(`**Automatic proposals by the current reconciler: ${f.reconciler_auto_proposals}.** ${f.note}`);
  lines.push("");
  lines.push(`DOB control group (SM rows with a verified date of birth): ${f.dob_control_group.sm_rows_with_dob} rows; ${f.dob_control_group.proposed_auto} auto-proposed, ${f.dob_control_group.review} to review, ${f.dob_control_group.no_candidate} without a candidate.`);
  lines.push("");
  lines.push("## Discovery from the TM side (recall proxy)");
  lines.push("");
  lines.push("| TM stratum | Players | Strict found | Strict, age-consistent | Wide found | Found by either | Wide only |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const [stratum, d] of Object.entries(summary.tm_side_discovery)) {
    lines.push(`| ${stratum} | ${d.total} | ${d.strict_found_pct}% | ${d.strict_age_consistent_found_pct}% | ${d.wide_found_pct}% | ${d.found_by_either_pct}% | ${d.wide_only} |`);
  }
  lines.push("");
  lines.push("## SM side");
  lines.push("");
  lines.push(`- With a strict candidate: ${s.with_strict_candidate} (${s.with_strict_candidate_pct}%); age-consistent: ${s.with_age_consistent_candidate}; wide only: ${s.wide_only}.`);
  lines.push(`- Candidate counts: ${Object.entries(s.candidate_count_buckets).map(([k, v]) => `${k}: ${v}`).join(", ")}.`);
  lines.push(`- Name variant behind the top candidate: ${Object.entries(s.best_candidate_name_variant).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  lines.push(`- Hypothetical rule H-age1 would fire for ${s.hypothetical_rule_h_age1_fires} players across ${s.hypothetical_rule_h_age1_distinct_tm_targets} TM players; ${s.hypothetical_rule_h_age1_colliding_tm_targets} TM players would be claimed by more than one SM row (${s.hypothetical_rule_h_age1_sm_rows_in_collisions} rows). Precision unknown until adjudicated.`);
  lines.push("");
  lines.push("| SM rating band | Players | With strict candidate | With wide candidate |");
  lines.push("| --- | --- | --- | --- |");
  for (const [band, b] of Object.entries(s.by_rating_band).sort()) {
    lines.push(`| ${band} | ${b.total} | ${b.with_strict_candidate} | ${b.with_wide_candidate} |`);
  }
  lines.push("");
  const a = summary.age_reliability_unverified_probes;
  lines.push(`## Age agreement on ${a.probes} unverified one-to-one probes`);
  lines.push("");
  lines.push("SM age minus TM age at the snapshot date: " + Object.entries(a.age_delta_histogram).sort((x, y) => Number(x[0]) - Number(y[0])).map(([k, v]) => `${k}: ${v}`).join(", "));
  lines.push("");
  const countries = Object.entries(summary.countries_without_tm_label);
  lines.push(`## SM countries with no matching TM label (${countries.length})`);
  lines.push("");
  lines.push(countries.slice(0, 40).map(([k, v]) => `${k} (${v})`).join(", ") || "None.");
  lines.push("");
  lines.push(`Gold samples: ${summary.gold_samples.tm_anchored} TM-anchored, ${summary.gold_samples.sm_anchored} SM-anchored, awaiting adjudication.`);
  return lines.join("\n") + "\n";
}

function run(opts) {
  if (!opts.sm || !opts.tm || !opts.out) throw new Error("run needs --sm, --tm and --out");
  const smBuffer = readFileSync(opts.sm);
  const tmBuffer = readFileSync(opts.tm);
  const smExport = JSON.parse(smBuffer);
  if (smExport.kind !== "sm-identity-benchmark-rows") throw new Error("Unexpected SM export kind");
  const tmRows = JSON.parse(tmBuffer);

  const result = runIdentityBenchmark({
    smRows: smExport.rows,
    tmRows: Array.isArray(tmRows) ? tmRows : tmRows.players,
    snapshotDate: String(smExport.observed_at).slice(0, 10),
    snapshotId: smExport.source_key,
    seed: opts.seed ?? "tbg-identity-benchmark"
  });

  result.summary.inputs.sm_sha256 = sha256(smBuffer);
  result.summary.inputs.tm_sha256 = sha256(tmBuffer);
  result.summary.inputs.code_commit = gitCommit();

  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "summary.json"), JSON.stringify(result.summary, null, 2) + "\n");
  writeFileSync(join(opts.out, "summary.md"), summaryMarkdown(result.summary));
  writeFileSync(join(opts.out, "candidates.private.jsonl"), result.candidates.map(c => JSON.stringify(c)).join("\n") + "\n");
  writeFileSync(join(opts.out, "gold-tm-anchored.private.csv"), toCsv(result.goldTm));
  writeFileSync(join(opts.out, "gold-sm-anchored.private.csv"), toCsv(result.goldSm));
  process.stdout.write(summaryMarkdown(result.summary));
}

function evaluate(opts) {
  if (!opts.dir) throw new Error("evaluate needs --dir");
  const tmFile = opts["tm-gold"] ?? join(opts.dir, "gold-tm-anchored.private.csv");
  const smFile = opts["sm-gold"] ?? join(opts.dir, "gold-sm-anchored.private.csv");
  const report = {
    discovery: evaluateTmGold(parseCsv(readFileSync(tmFile, "utf8"))),
    automatic: evaluateSmGold(parseCsv(readFileSync(smFile, "utf8")))
  };
  writeFileSync(join(opts.dir, "gold-evaluation.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

const opts = args(process.argv.slice(2));
const command = opts._[0];
if (command === "run") run(opts);
else if (command === "evaluate") evaluate(opts);
else {
  console.error("Usage: identity-benchmark.js run|evaluate [options]");
  process.exit(1);
}
