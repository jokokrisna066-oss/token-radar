// main.ts — the radar's entrypoint.
//
// One run does five things, in this order: find and parse the sealed snapshot, build the board and
// the page's dataset from it, refuse a board the gate would refuse, write the output directory, and
// print two lines saying what it wrote. Nothing lands on disk before the board is known good, so a
// run that fails leaves no half-written output for the next one to inherit.
//
//   input    --input <snapshot.json|dir>   else /input (snapshot.json inside it)
//   output   $MAKEFUN_OUTPUT_DIR           else /output, made if it is not there
//
// The snapshot is read, never fetched: this program opens no socket and imports nothing outside
// Node's standard library and the two files beside it.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The sealed snapshot's mount when the run names no --input. */
const SEALED_INPUT = '/input';
/** The grader's output mount when $MAKEFUN_OUTPUT_DIR is unset. */
const SEALED_OUTPUT = '/output';
/** The dossier's text cap: the page's source is shown whole while it fits under this many bytes. */
const TEXT_CAP = 65_536;
/** The fewest screenshots the page may be handed in with: the board, a detail view, a filter. */
const MIN_SCREENSHOTS = 3;

/**
 * The --input a command line names, as `--input <path>` or `--input=<path>`; the first one wins and
 * a flag with nothing after it is ignored, so a run with no --input reads the sealed mount.
 */
function inputArgument(argv: string[]): string {
  const flag = '--input';
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]!;
    if (word === flag && argv[i + 1] !== undefined) return argv[i + 1]!;
    if (word.startsWith(`${flag}=`)) return word.slice(flag.length + 1);
  }
  return SEALED_INPUT;
}

/**
 * The snapshot file an input names. A path whose text ends in .json is the file itself; anything
 * else is a directory holding snapshot.json. The test is on the text, never on the disk, so a path
 * that is not there is reported as the run asked for it rather than as a guess at what it meant.
 */
function snapshotFile(input: string): string {
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

/**
 * Copies a repository directory into the output and returns the names it copied, in code-unit order,
 * which is the order the dossier lists them in. A source that is not a directory copies nothing and
 * makes nothing, so the dossier's own refusal names the missing directory rather than this function.
 * A dot-name is left behind (it is not the page) and so is a subdirectory: the page is flat.
 */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from) || !statSync(from).isDirectory()) return [];
  const names = readdirSync(from, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && (entry.isFile() || entry.isSymbolicLink()))
    .map((entry) => entry.name)
    .sort();
  mkdirSync(to, { recursive: true });
  for (const name of names) copyFileSync(join(from, name), join(to, name));
  return names;
}

/** Ends the run with one line on stderr and the exit code the failure deserves. */
function refuse(reason: string, code: number): never {
  console.error(`token radar: ${reason}`);
  process.exit(code);
}

// ---------------------------------------------------------------- the run

const file = snapshotFile(inputArgument(process.argv.slice(2)));
if (!existsSync(file)) {
  refuse(`no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed ${SEALED_INPUT}`, 2);
}

const snapshot = parseSnapshot(readFileSync(file, 'utf8'));
const { board, radar } = buildRadar(snapshot);

const issue = boardIssue(board, snapshot);
if (issue !== null) refuse(`the model wrote a board the gate refuses: ${issue}`, 1);

const out = process.env.MAKEFUN_OUTPUT_DIR ?? SEALED_OUTPUT;
mkdirSync(out, { recursive: true });

const boardPath = join(out, 'board.json');
const dataPath = join(out, 'data.js');
writeFileSync(boardPath, `${JSON.stringify({ rows: board })}\n`);
writeFileSync(dataPath, dataScript(radar));

// The page and its screenshots come from the repository this file sits in, whatever the run's cwd.
const dashboardAt = join(out, 'dashboard');
const screenshotsAt = join(out, 'screenshots');
copyDirectory(join(import.meta.dirname, 'dashboard'), dashboardAt);
const shots = copyDirectory(join(import.meta.dirname, 'screenshots'), screenshotsAt);
if (shots.length < MIN_SCREENSHOTS) {
  const n = shots.length;
  refuse(`screenshots/ holds ${n} image${n === 1 ? '' : 's'}: hand in ${MIN_SCREENSHOTS}, the board, a detail view and a filtered view`, 1);
}

// The dossier is the library's own bytes over what now sits in the output directory, under the caps
// the gate reads: it refuses too many, too large or non-image screenshots and an oversized dashboard,
// and it shows the page's source whole while the whole of it fits under the cap.
const dossierPath = join(out, 'dossier.json');
const dossier = buildDossier(out, {
  text_max_bytes: TEXT_CAP,
  screenshots: { max: 4, max_bytes: 512 * 1024 },
  dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
});
writeFileSync(dossierPath, dossier);

console.log(
  `token radar: ${radar.protocol_count} protocols, ${radar.watchlist_size} on the watchlist, ${radar.board_size} rows scored ` +
    `(${radar.early_size} early, ${radar.live_size} live set aside)`,
);
console.log(
  `token radar: wrote ${boardPath}, ${dataPath}, ${dashboardAt} (3 files), ` +
    `${screenshotsAt} (${shots.length} images) and ${dossierPath}`,
);
