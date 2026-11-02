/* DataBrief command-line tool - the command line. GPL-3.0-or-later.
 * parse(argv) -> { opts, errors }: no checks that need the page's data (languages are checked in main.cjs). */
'use strict';

const NS_SWITCHES = ['names', 'labels', 'rel', 'file', 'text', 'sql'];
const MODES = ['inline', 'files'];
const LAYOUTS = ['auto', 'table', 'csv'];

// name -> { value: 'none' | 'required' | 'optional' (only with "=") , key }
const SPEC = {
  '--print': { key: 'print' },
  '--copy': { key: 'copy' },                              // the default, accepted so that a command can say it
  '--no-copy': { key: 'noCopy' },
  '--no_clip': { key: 'noCopy' },
  '--csv': { key: 'csv' },
  '--out': { key: 'out', value: 'required' },
  '--review': { key: 'review', value: 'optional' },
  '--no-share': { key: 'noShare', value: 'optional' },
  '--allow': { key: 'allow', value: 'required' },
  '--hide': { key: 'hide', value: 'required' },
  '--lang': { key: 'lang', value: 'required' },
  '--mode': { key: 'mode', value: 'required' },
  '--layout': { key: 'layout', value: 'required' },
  '--limit': { key: 'limit', value: 'required' },
  '--profile': { key: 'profile' },
  '--no-profile': { key: 'noProfile' },
  '--json': { key: 'json' },
  '--quiet': { key: 'quiet' },
  '-q': { key: 'quiet' },
  '--help': { key: 'help' },
  '-h': { key: 'help' },
  '--version': { key: 'version' },
  '-v': { key: 'version' },
};

function parse(argv) {
  const opts = { file: null };
  const errors = [];
  const files = [];
  let i = 0;
  let rest = false;
  const set = (key, v) => { if (opts[key] !== undefined && key !== 'file') errors.push('--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()) + ' is given twice'); else opts[key] = v; };
  while (i < argv.length) {
    const a = argv[i++];
    if (rest || a === '-' || !a.startsWith('-')) { files.push(a); continue; }
    if (a === '--') { rest = true; continue; }
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const name = eq < 0 ? a : a.slice(0, eq);
    const given = eq < 0 ? null : a.slice(eq + 1);
    const s = SPEC[name];
    if (!s) { errors.push('Unknown option: ' + name + ' (databrief --help lists them)'); continue; }
    if (!s.value) {
      if (given !== null) errors.push(name + ' takes no value');
      else set(s.key, true);
    } else if (s.value === 'optional') {
      set(s.key, given === null ? true : given);
    } else if (given !== null) {
      set(s.key, given);
    } else if (i < argv.length && !(argv[i].startsWith('-') && argv[i] !== '-')) {
      set(s.key, argv[i++]);
    } else {
      errors.push(name + ' needs a value');
    }
  }
  if (files.length > 1) {
    errors.push('One file at a time, got ' + files.length + ': ' + files.slice(0, 3).join(', ') + (files.length > 3 ? ', ...' : '') +
      (opts.review === undefined ? '' : '. To name an editor write --review=EDITOR (with an equal sign)'));
  } else if (files.length === 1) opts.file = files[0];
  return { opts, errors };
}

const HELP = `DataBrief command line: turns a data file into a prompt for an AI, with the same readers and rules as the page.

Usage:  databrief FILE [options]

What happens with the prompt (the prompt is copied to the clipboard unless --no-copy):
  --no-copy            do not copy to the clipboard (alias --no_clip)
  --print              print the prompt on standard output
  --csv                also write the data as CSV files: ./databrief/FILE_DATE_TIME/ gets the CSV files and prompt.md
  --out PATH           write prompt.md (and the CSV files with --csv) in a new FILE_DATE_TIME folder inside PATH.
                       An absolute PATH must exist; a relative PATH is placed under ./databrief
  --review[=EDITOR]    save initial_prompt.md, open a copy (prompt.md) in a text editor (EDITOR, else vim, nano, ...)
                       and use the edited prompt. Needs an interactive terminal
  --json               print one JSON object (prompt, files, warnings) instead of the prompt; for programs
  --quiet, -q          no summary on standard error

What the prompt contains (the options of the page):
  --no-share[=LEVEL]   Do not share data: the prompt describes the file without any record. LEVEL 1 structure only
                       (default), 2 + counts, 3 + summaries
  --allow=LIST         with --no-share: also include these (names, labels, rel, file, text, sql)
  --hide=LIST          with --no-share: leave these out (same names)
  --lang CODE          language of the prompt (en, fr, de, es, it, pt, nl, ...; default en)
  --mode inline|files  the data inside the prompt (default) or only a sample, the data in separate CSV files
  --limit N|auto       rows per table in the prompt (inline mode); auto = the page's suggestion for large files
  --layout auto|table|csv   how rows are written (default auto)
  --no-profile         leave out the data profile (statistics of every column)

  --help, -h           this text
  --version, -v        the version

Exit codes: 0 done, 1 the file could not be read, 2 wrong options, 3 nothing could be delivered.

Examples:
  databrief sales.xlsx                         copy the prompt to the clipboard
  databrief sales.xlsx --no-share              the same, without any data in it
  databrief dump.sql --print --no-copy         print it
  databrief orders.parquet --csv               prompt.md and the data as CSV files in ./databrief/...
  databrief report.docx --review=nano          edit the prompt before it is copied
`;

module.exports = { parse, HELP, NS_SWITCHES, MODES, LAYOUTS };
