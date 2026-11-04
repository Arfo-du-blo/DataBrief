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
  '--mcp': { key: 'mcp' },
  '--root': { key: 'root', value: 'required' },
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


/* ---------- the options, described once: --help, the man page (tools/build-man.cjs) and the tests all read this table ---------- */
const GROUPS = {
  prompt: 'What happens with the prompt',
  content: 'What the prompt contains',
  other: 'Other',
};
// flags: every spelling; arg: the value as written in the help; text: what it does
const OPTIONS = [
  { group: 'prompt', flags: ['--no-copy', '--no_clip'], text: 'Do not copy the prompt to the clipboard. By default it always is.' },
  { group: 'prompt', flags: ['--print'], text: 'Print the prompt on standard output.' },
  { group: 'prompt', flags: ['--csv'], text: 'Also write the data as CSV files: ./databrief/FILE_DATE_TIME/ gets the CSV files and prompt.md.' },
  { group: 'prompt', flags: ['--out'], arg: 'PATH', text: 'Write prompt.md (and the CSV files with --csv) in a new FILE_DATE_TIME folder inside PATH. An absolute PATH must exist; a relative PATH is placed under ./databrief.' },
  { group: 'prompt', flags: ['--review'], arg: '[=EDITOR]', equals: true, text: 'Save initial_prompt.md, open a copy (prompt.md) in a text editor (EDITOR, else vim, nano, then what the system has) and use the edited prompt. Needs an interactive terminal.' },
  { group: 'prompt', flags: ['--json'], text: 'Print one JSON object (the prompt, the files written, warnings) instead of the prompt, for programs. Add --no-copy to leave the clipboard alone.' },
  { group: 'prompt', flags: ['--quiet', '-q'], text: 'No summary on standard error (errors and a failed copy are still reported).' },
  { group: 'content', flags: ['--no-share'], arg: '[=LEVEL]', equals: true, text: 'Do not share data: the prompt describes the file without any record. LEVEL 1 structure only (default), 2 + counts, 3 + summaries. Level 3 summaries can include real values (a minimum, a maximum, category names): read the prompt before sending it.' },
  { group: 'content', flags: ['--allow'], arg: 'LIST', text: 'With --no-share: also include these (names, labels, rel, file, text, sql).' },
  { group: 'content', flags: ['--hide'], arg: 'LIST', text: 'With --no-share: leave these out (same names). --hide=file also keeps the file name out of everything the tool shows.' },
  { group: 'content', flags: ['--lang'], arg: 'CODE', text: 'Language of the prompt (en, fr, de, es, it, pt, nl, pl, ru, tr, zh, ja, ko, hi, ar; default en). The tool\'s own messages are in English.' },
  { group: 'content', flags: ['--mode'], arg: 'inline|files', text: 'The data inside the prompt (default), or only a sample in the prompt and the data in CSV files: add --csv to write them.' },
  { group: 'content', flags: ['--limit'], arg: 'N|auto', text: 'Rows per table in the prompt (inline mode). auto = the page\'s suggestion for a large file.' },
  { group: 'content', flags: ['--layout'], arg: 'auto|table|csv', text: 'How rows are written (default auto: tables for small sections, CSV for large ones).' },
  { group: 'content', flags: ['--no-profile'], text: 'Leave out the data profile (statistics of every column).' },
  { group: 'other', flags: ['--mcp'], text: 'Run as a local MCP server on standard input and output, for AI agents (Claude Code, Codex, Gemini CLI...): one tool, databrief_analyze, reads a file by its path in Do not share data or not, as the AI asks. No file and no other option but --root.' },
  { group: 'other', flags: ['--root'], arg: 'DIR', text: 'With --mcp: read only files whose real path (links followed) is inside DIR. Without it, the AI can ask for any file you can read.' },
  { group: 'other', flags: ['--help', '-h'], text: 'This text.' },
  { group: 'other', flags: ['--version', '-v'], text: 'The version.' },
];
// accepted, listed nowhere: the default, so that a command can say it
const HIDDEN_FLAGS = ['--copy', '--profile'];

const EXIT_CODES = [
  [0, 'done'],
  [1, 'the file could not be read (missing, damaged, not supported, too large, not a regular file)'],
  [2, 'wrong options (nothing was done)'],
  [3, 'not delivered as asked: the clipboard, the files or the editor failed (the prompt is still printed or copied when it could be)'],
];

const NOTES = [
  'The tool reads files with the same code as the page, with the page\'s default settings (no team configuration).',
  'An AI agent that can run this tool can often read the file itself: --no-share controls what DataBrief outputs, not what the agent can open.',
];

const EXAMPLES = [
  ['databrief sales.xlsx', 'copy the prompt to the clipboard'],
  ['databrief sales.xlsx --no-share', 'the same, without any data in it'],
  ['databrief dump.sql --print --no-copy', 'print it'],
  ['databrief orders.parquet --csv', 'prompt.md and the data as CSV files in ./databrief/...'],
  ['databrief orders.parquet --mode files --csv', 'a short prompt and the data as CSV files, for AIs that run code'],
  ['databrief report.docx --review=nano', 'edit the prompt before it is copied'],
  ['databrief --mcp --root .', 'an MCP server for an AI agent, limited to this folder'],
];

const flagText = (o) => o.flags.map((f, i) => (i === 0 && o.arg ? (o.equals ? f + o.arg : f + ' ' + o.arg) : f)).join(', ');

function wrap(text, width, indent) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i ? indent : '') + l).join('\n');
}

function buildHelp() {
  const COL = 28, WIDTH = 100;
  const pad = ' '.repeat(COL);
  const out = ['DataBrief command line: turns a data file into a prompt for an AI, with the same readers and rules as the page.', '', 'Usage:  databrief FILE [options]', ''];
  for (const [key, title] of Object.entries(GROUPS)) {
    out.push(title + (key === 'prompt' ? ' (the prompt is copied to the clipboard unless --no-copy):' : ':'));
    for (const o of OPTIONS.filter((x) => x.group === key)) {
      const f = '  ' + flagText(o);
      const body = wrap(o.text, WIDTH - COL, pad);
      out.push(f.length < COL - 1 ? f.padEnd(COL) + body : f + '\n' + pad + body);
    }
    out.push('');
  }
  out.push('Exit codes:');
  for (const [c, t] of EXIT_CODES) out.push('  ' + c + '  ' + wrap(t, WIDTH - 5, '     '));
  out.push('', 'Notes:');
  for (const n of NOTES) out.push('  ' + wrap(n, WIDTH - 4, '    '));
  out.push('', 'Examples:');
  for (const [c, t] of EXAMPLES) out.push('  ' + c.padEnd(46) + t);
  out.push('');
  return out.join('\n');
}
const HELP = buildHelp();

module.exports = { parse, HELP, OPTIONS, GROUPS, EXIT_CODES, NOTES, EXAMPLES, HIDDEN_FLAGS, SPEC, flagText, NS_SWITCHES, MODES, LAYOUTS };
