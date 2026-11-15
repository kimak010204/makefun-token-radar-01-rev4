// Token Radar, radar-4: read the sealed DefiLlama snapshot and write out a ranked
// board of pre-token protocols, the dashboard that displays it, and the dossier the
// judge reads. Nothing here reaches the network and nothing reads a clock: every
// number comes from the snapshot, so two runs over the same file write identical bytes.
//
// The pipeline, in order:
//   1. Parse the snapshot (758 protocols, 40 of them on the house watchlist).
//   2. Score every rankable pre-token protocol with radar-4 — a category median of
//      market-cap-per-TVL shrunk toward the global median, times growth, maturity and
//      chain breadth — and rank by the implied value that gives.
//   3. Run the gate check first: a board that would fail the gate (a missing watchlist
//      slug, ranks out of order, an implied value rising with rank, a farm plan outside
//      3-12 steps or 20-600 characters) is never written at all.
//   4. Write board.json, data.js, copy dashboard/ and screenshots/ into the output,
//      and write dossier.json with the kit's own buildDossier, so the dossier the judge
//      reads is byte for byte what the library writes from these files.
//
// Run it like this:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The scoring itself lives in lib/model.ts and the dossier in vendor/makefun-board.ts
// (the kit's own library, copied byte for byte). This file is only the wiring:
// argument parsing, the gate check, the file copies, and the summary printed so a run
// can be checked at a glance. Determinism is a gate condition, not a hope — the gate
// runs this program twice and the bytes must match — so there is no clock, no random
// source and no network anywhere in here, and every row is sorted by a total order
// (implied value, then TVL, then slug).
//
// Verify before handing in: run twice into two output directories and diff them, then
// check the board by hand (198 rows, ranks 1..198, all 40 watchlist slugs, farm plans
// of 8 steps at 20-600 characters), and render the dashboard in a headless browser at
// 1440x900 for the three screenshots. The screenshots and the code agree because they
// are rendered from the same data.js this program writes.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  join,
} from 'node:path';
import {
  fileURLToPath,
} from 'node:url';
import {
  boardIssue,
  buildRadar,
  dataScript,
  parseSnapshot,
} from './lib/model.ts';
import {
  buildDossier,
} from './vendor/makefun-board.ts';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/** Caps handed to the dossier builder: text size, screenshots, dashboard. */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** One --name <value> from the arguments, or the fallback when it is absent. */
function flag(name: string, fallback: string): string {
  const pos = process.argv.indexOf('--' + name);
  if (pos >= 0 && pos + 1 < process.argv.length) {
    return process.argv[pos + 1]!;
  }
  const joined = process.argv.find((a) => a.startsWith('--' + name + '='));
  if (joined === undefined) {
    return fallback;
  }
  return joined.slice(name.length + 3);
}

const inputOpt = flag('input', '/input');
const snapPath = inputOpt.endsWith('.json') ? inputOpt : join(inputOpt, 'snapshot.json');
if (!existsSync(snapPath)) {
  const hint = 'token radar: no snapshot at ' + snapPath +
    ': pass --input <snapshot.json|directory> or mount the sealed /input\n';
  process.stderr.write(hint);
  process.exit(2);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(snapPath, 'utf8'));
const built = buildRadar(snap);
const ranked = built.board;
const data = built.radar;
const problem = boardIssue(ranked, snap);
if (problem !== null) {
  process.stderr.write('token radar: the model wrote a board the gate refuses: ' + problem + '\n');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const boardText = JSON.stringify({ rows: ranked }) + '\n';
writeFileSync(join(outDir, 'board.json'), boardText);
writeFileSync(join(outDir, 'data.js'), dataScript(data));

/** Copy one directory's regular files into `dst`, skipping names that start with a dot. */
function copyDirFiles(src: string, dst: string): string[] {
  if (!existsSync(src)) {
    return [];
  }
  mkdirSync(dst, { recursive: true });
  const moved: string[] = [];
  const names = readdirSync(src);
  for (const name of names) {
    if (name.startsWith('.')) {
      continue;
    }
    const path = join(src, name);
    if (!statSync(path).isFile()) {
      continue;
    }
    copyFileSync(path, join(dst, name));
    moved.push(name);
  }
  return moved;
}

const pageFiles = copyDirFiles(join(rootDir, 'dashboard'), join(outDir, 'dashboard'));
const images = copyDirFiles(join(rootDir, 'screenshots'), join(outDir, 'screenshots'));
if (images.length < 3) {
  const plural = images.length === 1 ? '' : 's';
  process.stderr.write(
    'token radar: screenshots/ holds ' + images.length + ' image' + plural +
    ': hand in 3, the board, a detail view and a filtered view\n',
  );
  process.exit(1);
}
for (const name of images) {
  if (!SHOT_NAME.test(name)) {
    process.stderr.write(
      'token radar: screenshots/' + name +
      ': a name is letters, digits and . _ -, 1 to 128 characters\n',
    );
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares
// bytes, so what is written here must be exactly what buildDossier writes from these files.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_CAP,
    screenshots: SHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);
const dossierSize = statSync(join(outDir, 'dossier.json')).size;

// A short summary, so a run can be checked at a glance: how many protocols, how many
// rows, the top five launches, how the multiples break down by confidence, and the size
// of the dossier the judge will read.
const topFive = ranked
  .slice(0, 5)
  .map((r) => r.name + ' $' + r.implied_value_usd.toLocaleString('en-US'))
  .join(", ");
const bandCounts = data.stats.value_bands;
const topCatLines = data.stats.top_categories
  .map((c) => c.category + ' $' + c.implied_usd.toLocaleString('en-US'))
  .join(", ");
const summaryLines = [
  'token radar: ' + snap.protocols.length + ' protocols, ' + snap.watchlist.length +
    ' on the watchlist, ' + ranked.length + ' rows ranked (' + data.early_size +
    ' early, ' + data.live_size + ' live set aside)',
  'token radar: top 5: ' + topFive,
  'token radar: model ' + data.model_version + ', global multiple ' + data.global_multiple.toFixed(3) +
    ', multiples: ' + data.composition.priced + ' priced, ' + data.composition.thin +
    ' thin, ' + data.composition.fallback + ' fallback',
  'token radar: value bands: ' + bandCounts.over_1b + ' over $1B, ' + bandCounts.b100m_1b +
    ' at $100M-$1B, ' + bandCounts.m10_100m + ' at $10M-$100M, ' + bandCounts.under_10m + ' under $10M',
  'token radar: top categories: ' + topCatLines,
  'token radar: watchlist TVL $' + data.watchlist_tvl.toLocaleString('en-US') +
    ' of $' + data.total_pretoken_tvl.toLocaleString('en-US') + ' tracked',
  'token radar: wrote ' + join(outDir, 'board.json') + ', ' + join(outDir, 'data.js') + ', ' +
    join(outDir, 'dashboard') + ' (' + pageFiles.length + ' files), ' + join(outDir, 'screenshots') +
    ' (' + images.length + ' images) and ' + join(outDir, 'dossier.json') +
    ' (' + dossierSize.toLocaleString('en-US') + ' bytes)',
];
process.stdout.write(summaryLines.join('\n') + '\n');
