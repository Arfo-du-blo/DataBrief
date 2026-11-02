#!/usr/bin/env node
/* Builds man/databrief.1, the manual of the command-line tool.   node tools/build-man.cjs [OUTPUT]
 * The options, the exit codes, the notes and the examples are the ones of `databrief --help` (cli/args.cjs): one source. The
 * longer sections are written here. No date and no machine detail in the file: the same sources give the same bytes, which
 * tests/test_cli.cjs checks (the committed man/databrief.1 must be what this script writes).
 * Installed by the packages (step "distribution"): /usr/share/man/man1/databrief.1.gz, Homebrew man1.install, npm "man". */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('../cli/args.cjs');

const ROOT = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/* roff: a backslash is \e, a hyphen \-, a line starting with . or ' gets \& in front */
const esc = (s) => String(s).replace(/\\/g, '\\e').replace(/-/g, '\\-').replace(/^([.'])/, '\\&$1');
const lines = [];
const out = (s) => lines.push(s);
const section = (title) => out('.SH ' + title);
const sub = (title) => out('.SS ' + esc(title));
const p = (s) => { out('.PP'); out(esc(s)); };

function render() {
  lines.length = 0;
  out('.\\" DataBrief ' + version + ' manual. Written by tools/build-man.cjs from cli/args.cjs: do not edit by hand.');
  out('.TH DATABRIEF 1 "" "DataBrief ' + version + '" "User Commands"');
  section('NAME');
  out('databrief \\- turn a data file into a prompt for an AI, offline');
  section('SYNOPSIS');
  out('.B databrief');
  out('.I FILE');
  out('.RI [ options ]');
  section('DESCRIPTION');
  p('databrief reads one data file with the same code as the DataBrief page (https://github.com/Arfo-du-blo/DataBrief) and writes a Markdown prompt that gives an AI assistant the data and its context: the structure, the types, the keys and relationships, the metadata and, for documents, the text around the tables. 29 formats are read: delimited text, spreadsheets, JSON, XML, YAML, HTML, SPSS, Parquet, Avro, Arrow, SQLite, SQL dumps, PostgreSQL archives, DuckDB exports, SQL Server packages, Access, DBF, GeoJSON, GeoPackage, Jupyter notebooks, Word, PowerPoint, OpenDocument and PDF.');
  p('Nothing is uploaded: the tool makes no network connection. The prompt is copied to the clipboard; with the options below it is also printed, written to files, or edited in a text editor first.');
  section('OPTIONS');
  for (const [key, title] of Object.entries(A.GROUPS)) {
    sub(title);
    for (const o of A.OPTIONS.filter((x) => x.group === key)) {
      out('.TP');
      // every spelling in bold, the value in italics (--review[=EDITOR], --out PATH)
      out(o.flags.map((f, i) => '\\fB' + esc(f) + '\\fR' + (i === 0 && o.arg ? (o.equals ? '' : ' ') + '\\fI' + esc(o.arg) + '\\fR' : '')).join(', '));
      out(esc(o.text));
    }
  }
  section('OUTPUT FILES');
  p('With --csv, --out or --review, everything is written in one new folder named FILE_YYYY-MM-DD_HH-MM-SS (local time; -2, -3 when it exists): prompt.md, the data as CSV files (--csv), and initial_prompt.md (--review). Without --out the folder is made inside ./databrief of the current folder. With --out, an absolute PATH must already exist; a relative PATH is placed under ./databrief and the tool says so; ".." is refused. Files are never overwritten. The data files carry the names the prompt gives them, changed only where a disk refuses a name.');
  section('DO NOT SHARE DATA');
  p('--no-share writes a prompt that describes the file without any record: the structure at level 1, plus counts at level 2, plus summaries at level 3 (a minimum, a maximum and category names are real values: read the prompt before sending it). Free text (comments, notes, the text of documents, SQL definitions) is left out unless --allow=text,sql; names, labels, the file name and relationships are included unless --hide. The title, author and company of a file are never shown, in any mode. With --csv the CSV files still hold the data (they stay on this computer); their names follow the same rules as the prompt. Error messages never quote the file.');
  p('This controls what DataBrief outputs. An AI agent that can run this tool can often read the file itself: do not rely on it to keep the data from an agent that has access to your files.');
  section('REVIEW');
  p('--review saves the prompt as initial_prompt.md and prompt.md, then opens prompt.md in the editor given (--review=EDITOR), else vim, else nano, else $VISUAL, $EDITOR, or what the system has (notepad on Windows, TextEdit on macOS, editor, vi...). A missing editor is skipped and the next one is tried; the summary says which was used. Editors that return at once (a graphical window) get a "press Enter" wait. The clipboard receives the edited prompt. Vim and Neovim open it with modelines off and Emacs with file-local variables off. It needs a terminal on standard input and output: from a pipe, a script or an AI agent\'s shell it refuses and does nothing.');
  section('EXIT STATUS');
  for (const [c, t] of A.EXIT_CODES) { out('.TP'); out('.B ' + c); out(esc(t)); }
  section('ENVIRONMENT');
  out('.TP'); out('.B VISUAL, EDITOR'); out('The editor of --review when none is named and neither vim nor nano is installed.');
  out('.TP'); out('.B PATH'); out('Where editors and the clipboard tools are looked for. The current folder is not searched.');
  out('.TP'); out('.B WAYLAND_DISPLAY'); out('Linux: when set, wl\\-copy is tried before xclip and xsel.');
  section('FILES');
  out('.TP'); out('.B ./databrief/'); out('The folder of the files written by --csv and by a relative --out.');
  section('LIMITS');
  for (const n of A.NOTES) p(n);
  p('Differences from the page: the tool uses the built-in settings (no team configuration or locked settings); XML files that use parameter entities and HTML nested more than 5000 levels are refused; there is no time limit on reading a file. Files larger than 2 GB are refused. The clipboard needs PowerShell (Windows, WSL), pbcopy (macOS) or wl\\-copy, xclip or xsel (Linux).');
  section('EXAMPLES');
  for (const [c, t] of A.EXAMPLES) { out('.TP'); out('.B ' + esc(c)); out(esc(t[0].toUpperCase() + t.slice(1) + '.')); }
  section('SEE ALSO');
  out('The guides in docs/cli.md and docs/formats/ of the repository, and https://arfo\\-du\\-blo.github.io/DataBrief/ for the page.');
  section('LICENSE');
  out('GNU General Public License, version 3 or later.');
  return lines.join('\n') + '\n';
}

module.exports = { render };
if (require.main === module) {
  const target = path.resolve(process.argv[2] || path.join(ROOT, 'man', 'databrief.1'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, render(), 'utf8');
  console.log(path.relative(process.cwd(), target));
}
