#!/usr/bin/env node
/**
 * Parity score for the exclusive collection.
 *
 * Implements the scoring rule from the `replica-diff` skill: every feature is
 * weighted by priority, a partial implementation counts half, skipped rows are
 * never scored (they are not part of the clone), and a missing must-have makes
 * the result "not shippable" regardless of the percentage.
 *
 * This is an independent implementation written for this repository (MIT); it
 * follows the documented method rather than copying the skill's script.
 *
 * Usage:
 *   node tools/replica-parity.mjs [replica/features.csv]
 *   npm run parity
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** Priority weights. Must outweighs should, which outweighs could. */
export const WEIGHTS = { must: 5, should: 3, could: 1 };

/**
 * Parse the skill's feature matrix: `feature,area,priority,original,clone,notes`.
 * Handles quoted fields containing commas and doubled quotes.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length && !(row.length === 1 && row[0].trim() === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushField();
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }
  pushField();
  pushRow();

  if (!rows.length) return [];
  const header = rows.shift().map((name) => name.trim().toLowerCase());
  return rows.map((values) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = (values[index] ?? "").trim();
    });
    return record;
  });
}

/** Every value the `clone` column accepts. Anything else is a malformed row. */
export const CLONE_VALUES = new Set([
  "yes",
  "partial",
  "no",
  "skip",
  "done",
  "wip",
  "half",
  "true",
  "false",
  "skipped",
  "na",
  "n/a",
]);

/** Completion of one row: yes = 1, partial = 0.5, no = 0, skip = not scored. */
export function completionOf(clone) {
  const value = (clone || "").toLowerCase();
  if (value === "yes" || value === "done" || value === "true") return 1;
  if (value === "partial" || value === "half" || value === "wip") return 0.5;
  if (value === "skip" || value === "skipped" || value === "na" || value === "n/a") return null;
  return 0;
}

/**
 * Score a feature matrix.
 *
 * Returns the weighted percentage, the per-area breakdown, every missing
 * must-have, and `shippable` (false when a must-have is missing).
 */
export function scoreFeatures(rows) {
  let earned = 0;
  let possible = 0;
  const areas = new Map();
  const missingMust = [];
  const skipped = [];
  const malformed = [];

  for (const row of rows) {
    const cloneToken = (row.clone || "").toLowerCase();
    if (!CLONE_VALUES.has(cloneToken)) {
      // A shifted column (an unquoted comma in a feature name) silently turns a
      // real row into nonsense. Say so instead of quietly dropping it.
      malformed.push(`${row.feature} (clone="${row.clone}")`);
      continue;
    }

    const completion = completionOf(row.clone);
    if (completion === null) {
      // Content, brand and monetisation rows are out of scope, never "missing".
      skipped.push(row.feature);
      continue;
    }

    const priority = (row.priority || "").toLowerCase();
    const weight = WEIGHTS[priority];
    if (!weight) continue;

    possible += weight;
    earned += weight * completion;

    const area = row.area || "other";
    const bucket = areas.get(area) || { earned: 0, possible: 0, total: 0 };
    bucket.earned += weight * completion;
    bucket.possible += weight;
    bucket.total += 1;
    areas.set(area, bucket);

    if (priority === "must" && completion < 1) missingMust.push(row.feature);
  }

  const score = possible === 0 ? 0 : Math.round((earned / possible) * 1000) / 10;
  return {
    score,
    earned,
    possible,
    features: rows.filter((row) => WEIGHTS[(row.priority || "").toLowerCase()]).length,
    scored: rows.filter((row) => completionOf(row.clone) !== null).length,
    skipped: skipped.length,
    areas: Object.fromEntries(
      [...areas.entries()]
        .map(([area, bucket]) => [
          area,
          { percent: bucket.possible ? Math.round((bucket.earned / bucket.possible) * 1000) / 10 : 0, features: bucket.total },
        ])
        .sort((a, b) => a[0].localeCompare(b[0]))
    ),
    missingMust,
    malformed,
    shippable: missingMust.length === 0 && malformed.length === 0,
  };
}

export function formatReport(result) {
  const lines = [];
  lines.push(`Parity: ${result.score}%  (${result.scored - result.skipped} scored, ${result.skipped} skipped)`);
  lines.push("");
  for (const [area, bucket] of Object.entries(result.areas)) {
    lines.push(`  ${area.padEnd(12)} ${String(bucket.percent).padStart(5)}%   ${bucket.features} feature(s)`);
  }
  if (result.missingMust.length) {
    lines.push("");
    lines.push("Missing must-haves (not shippable):");
    for (const feature of result.missingMust) lines.push(`  - ${feature}`);
  }
  if (result.malformed.length) {
    lines.push("");
    lines.push("Malformed rows (fix the CSV):");
    for (const entry of result.malformed) lines.push(`  - ${entry}`);
  }
  lines.push("");
  lines.push(
    result.shippable
      ? "Shippable: every must-have is implemented."
      : "NOT shippable: a must-have is missing or the matrix has a malformed row."
  );
  return lines.join("\n");
}

export function loadFeatures(path) {
  return parseCsv(readFileSync(path, "utf8"));
}

export function run(path = resolve(process.cwd(), "replica/features.csv")) {
  const result = scoreFeatures(loadFeatures(path));
  console.log(formatReport(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = run(process.argv[2]);
  // Missing must-haves are a failing exit code, exactly like the skill's preflight.
  process.exitCode = result.shippable ? 0 : 1;
}
