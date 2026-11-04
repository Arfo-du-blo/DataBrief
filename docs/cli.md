# The command-line tool

The same readers and the same [Do not share data](no-share.md) rules as the page, in a terminal. It reads the same
[29 formats](../README.md#supported-formats), makes no network connection, and gives **the same prompt as the page**.

[← Back to the README](../README.md#command-line)

## Get it

Every way gives you the same tool. **You need Node.js 18 or newer** (checked at start; an older one gets a clear message).
Nothing else, except a clipboard tool on Linux (below).

| You use | Install | Node.js |
|---|---|---|
| **npm**, any system | `npx databrief FILE` (nothing installed), or `npm install -g databrief` | you have it |
| **Ubuntu, Debian** | `sudo apt install ./databrief_1.6.0_all.deb`, the file from the [release](https://github.com/Arfo-du-blo/DataBrief/releases/latest) | `apt` installs `nodejs` (recommended by the package); on a system whose Node is older than 18 (Ubuntu 22.04 has Node 12), install a newer one (NodeSource, nvm...): see [Troubleshooting](#troubleshooting) |
| **Homebrew**, macOS or Linux | `brew install Arfo-du-blo/databrief/databrief` | Homebrew installs it |
| **Scoop**, Windows | `scoop bucket add databrief https://github.com/Arfo-du-blo/scoop-databrief`, then `scoop install databrief` | Scoop installs `nodejs-lts` |
| **One file**, any system | download `databrief-cli.cjs` from the release, then `node databrief-cli.cjs FILE` | you have it |
| **From the sources** | `node tools/build-cli.cjs` writes `dist/databrief-cli.cjs`; `node tools/build-npm.cjs` and `node tools/build-deb.cjs` write the packages | you have it |

- **Check what you downloaded:** every file of a [release](https://github.com/Arfo-du-blo/DataBrief/releases/latest) is in
  `SHA256SUMS.txt` (`sha256sum -c SHA256SUMS.txt`, or `Get-FileHash` on Windows), like the page. The Homebrew formula and the
  Scoop manifest carry the same fingerprint of `databrief-cli.cjs`, and the package manager checks it.
- **The builds are reproducible:** the same sources give the same bytes, on every system. The npm package holds exactly the
  file of the release, and it is published by GitHub Actions with a provenance record (npmjs.com shows where it was built).
- **The `.deb`** is one package for every architecture (the tool is JavaScript). It installs `/usr/bin/databrief`, the manual
  (`man databrief`) and the licenses of the libraries inside the tool in `/usr/share/doc/databrief/`. `apt remove databrief`
  leaves nothing behind. It was installed and removed in clean Ubuntu 26.04, 24.04 and Debian systems, and passes `lintian`.

In this guide `databrief` is the command the install gives you. With the one file, write `node databrief-cli.cjs` instead
(or, on Linux and macOS, `chmod +x databrief-cli.cjs` and run `./databrief-cli.cjs`, since it starts with `#!/usr/bin/env node`).

```bash
databrief --help
databrief sales.xlsx
```

## What it does

`databrief FILE [options]` reads the file, builds the prompt, and **copies it to the clipboard**. Nothing else happens
unless you ask: no file is written, nothing is printed on standard output. A summary on standard error says what was
done.

```
Read sales.xlsx (Excel (XLSX)). The prompt is about 1,204 tokens.
The prompt holds the data of the file.
Copied to the clipboard (powershell.exe).
```

| You want | Option |
|---|---|
| to print the prompt | `--print` |
| not to touch the clipboard | `--no-copy` (or `--no_clip`) |
| the data as CSV files, and `prompt.md`, in a folder | `--csv` |
| the same folder somewhere else | `--out PATH` |
| to edit the prompt before it is used | `--review` or `--review=EDITOR` |
| a result for a program | `--json` (add `--no-copy`) |
| no summary | `--quiet` |

`--no-copy` alone would do nothing, so it is refused unless something else delivers the prompt (`--print`, `--csv`,
`--out`, `--review` or `--json`).

### The clipboard

| System | Tool used |
|---|---|
| Windows, and WSL | PowerShell (`Set-Clipboard`, the text sent as UTF-8), else `clip.exe` |
| macOS | `pbcopy` |
| Linux | `wl-copy` (Wayland), `xclip`, `xsel`: install one of them |

If none works, the tool says so, and still prints or writes what you asked for; if nothing else was asked, it exits with
code 3.

### The files it writes

With `--csv`, `--out` or `--review`, everything goes into **one new folder** named `FILE_YYYY-MM-DD_HH-MM-SS` (local
time; `-2`, `-3` if it exists):

```
databrief/sales_2026-11-02_14-35-07/
  prompt.md          the prompt
  Sheet1.csv         the data, one file per table (--csv)
  initial_prompt.md  the prompt as it was before you edited it (--review)
```

- `--csv` alone: the folder is made in `./databrief`, inside the current folder.
- `--out PATH`: the folder is made inside `PATH`. An **absolute** `PATH` must already exist (the tool checks before it
  reads the file). A **relative** `PATH` is placed under `./databrief`, created if needed, and the summary says so;
  `..` is refused, so a relative path cannot leave `./databrief`.
- Nothing is ever overwritten. The data files carry the names the prompt gives them, changed only where a disk would
  refuse a name (a device name like `CON`, trailing dots, characters that reverse the reading direction).
- With `--mode files` the prompt asks the AI to load CSV files: add `--csv` to write them (the tool warns if you forget).

### Reviewing the prompt

`--review` saves `initial_prompt.md` and `prompt.md`, opens `prompt.md` in a text editor, waits, and puts the **edited**
prompt on the clipboard.

- The editor: the one you name (`--review=nano`), else `vim`, else `nano`, else `$VISUAL`, `$EDITOR`, then what the
  system has (Notepad, TextEdit, `editor`, `vi`...). **A missing editor is skipped** and the next one is tried; the
  summary says which one was used. Only if none exists is there an error.
- Editors that open a window and return at once get a prompt: *Press Enter here when you have saved and closed the file*.
- Vim and Neovim open the prompt with modelines off, and Emacs with file-local variables off: the prompt holds text from
  your file, which an editor should not obey.
- It needs a **terminal** (standard input and output). From a pipe, a script or an AI agent's shell it refuses at once
  with a clear message and does nothing: use `--csv` or `--out` there and edit `prompt.md` yourself.
- If you empty the prompt, nothing is copied (exit code 3); `initial_prompt.md` keeps the original.

## What the prompt contains

The page's options, under the same names:

| Option | Meaning |
|---|---|
| `--no-share[=LEVEL]` | [Do not share data](no-share.md): no record in the prompt. Level 1 structure (default), 2 + counts, 3 + summaries |
| `--allow=LIST`, `--hide=LIST` | with `--no-share`: include or leave out `names`, `labels`, `rel`, `file`, `text`, `sql` |
| `--lang CODE` | prompt language (15: en, fr, es, de, it, pt, nl, pl, ru, tr, zh, ja, ko, hi, ar) |
| `--mode inline\|files` | the data inside the prompt, or a sample and the data in CSV files |
| `--limit N\|auto` | rows per table (inline mode); `auto` is the page's suggestion for a large file |
| `--layout auto\|table\|csv` | how rows are written |
| `--no-profile` | no data profile |

A prompt over about 150,000 tokens gets a warning that says what to do (`--limit auto`, `--mode files`, `--no-share`).

### With `--no-share`

- The prompt is **built from a record-free copy**, as on the page; the same canary tests run on the tool, in every
  output: standard output, standard error, the clipboard, `prompt.md`, the JSON and the names of the folders and files.
- **Level 3 puts real values in the prompt** (a minimum, a maximum, category names). The tool says so in its summary and
  warns, as the page does.
- **`--csv` still writes the data** (on your computer): the prompt holds none, the CSV files do, and the summary says
  both. Their names follow the same rules as the prompt: keys that look like data (an e-mail, a date), captions used as
  labels, a hidden file name or hidden names are never in a file name.
- **`--hide=file`** keeps the file name out of everything the tool shows: the summary, the JSON, the error messages, the
  folder (`dataset_...`).
- **Error messages never quote the file** (a parser's message can).
- Options the page does not have in this mode (`--limit`, `--mode`, `--layout`, `--no-profile`) are said to be ignored.
- **The catch:** this controls what DataBrief outputs. **An AI agent that can run this tool can often read the file
  itself.** If the agent must not see the data, do not give it access to the file.

### Who made the file

The author, the last editor and the company of a file are never shown, in any format and mode; writer metadata that
names a person or a team (`owner`, `author`, `contact`...) is dropped. See [the formats](../README.md#supported-formats).

## For programs: `--json`

```bash
databrief sales.xlsx --json --no-copy
```

One JSON object on standard output (`ok`, `version`, `file`, `format`, `shared`, `level`, `tokens`, `prompt`, `copied`,
`folder`, `files`, `reviewed`, `large`, `notes`, `warnings`, `writeError`); an error is `{"ok": false, "error": {...}}` with exit code 1.
On a terminal, characters that could act on it (C1 controls, direction overrides) are written as `\uXXXX`: the JSON stays
valid and means the same.

## As an MCP server: `--mcp`

```bash
databrief --mcp                # AI agents start this and talk to it on standard input and output
databrief --mcp --root .       # ... and may read only files inside the folder the agent starts it in
```

`--mcp` turns the tool into a local [MCP](https://modelcontextprotocol.io) server for AI agents. It takes no file and no option but `--root DIR`, and it
offers one tool, `databrief_analyze` (the absolute path of a file and `share` yes or no, required): the same code and the same prompt as `--json --no-copy`.
It starts no program, opens no connection, writes no file, and its log on standard error holds method names and timings, never a path or any content. With
`--root DIR` only files inside DIR are read (links are followed to the real file; a link out of DIR, a hard link and a network path are refused). The agents'
configurations, the skill and the limits are in [docs/agents.md](agents.md).

## Exit codes

| Code | Meaning |
|---|---|
| 0 | done |
| 1 | the file could not be read (missing, damaged, not supported, too large, not a regular file) |
| 2 | wrong options (nothing was done) |
| 3 | not delivered as asked: the clipboard, the files or the editor failed |

If the files cannot be written, the prompt is still copied (or printed), the failure is said, and the code is 3.

## Safety

- **No network:** the tool opens no connection. A test runs it with every network API of Node blocked and logged.
- **No shell:** programs (the clipboard tool, an editor) get their arguments as a list. The one exception is a Windows
  `.cmd` launcher (VS Code's `code.cmd`), run through `cmd.exe` with every part quoted, and refused if the path holds a
  character `cmd.exe` would read inside quotes (`"`, `%`).
- **The file is untrusted:** only regular files are read (a device or a pipe is refused), up to 2 GB, checked again
  through the open file; the reading code runs in a separate Node realm with no `require`, no `process`, no network API
  and no code from strings (this keeps it from using Node by accident; it is not a security boundary). XML entity
  bombs, huge DOCTYPEs, deeply nested HTML and malformed files are refused or read quickly.
- **The terminal is protected:** control characters and direction overrides in names or data are shown as `�` on a
  terminal (the clipboard, files and pipes get the data as it is, like the page).
- **Folder and file names** are cleaned of separators, control characters and Windows device names, so a name like
  `$(touch x).csv` or `../..` runs nothing and goes nowhere.

## Differences from the page

The tool runs the page's reading code, and a test compares the two on every test file in five settings. The known
differences:

- It uses the page's **built-in settings**: no team configuration, no locked settings, no custom introduction text.
- **XML files that use parameter entities** (`%name;` in the DOCTYPE) and **HTML nested more than 5000 levels** are
  refused (an error, never different data). Browsers read the second kind.
- There is **no time limit** on reading a file (the page shows a spinner you can leave).
- **Files up to 2 GB**; the page is limited by the browser's memory.
- The tool's own messages are in English; the prompt language follows `--lang`.
- `vi` is opened as it is (it may not be Vim): only `vim`, `nvim` and `emacs` get the modeline protection.

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| `databrief needs Node.js 18 or newer (this is 12.x)` | Your system's Node.js is too old (Ubuntu 22.04 has Node 12). Install a current one **without `sudo`** with [nvm](https://github.com/nvm-sh/nvm): `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh \| bash`, open a new terminal (or `. ~/.nvm/nvm.sh`), then `nvm install 22` (**`nvm install 22`**: `npm install 22` would install an unrelated npm package named "22"). Check with `node -v`. |
| `nvm: command not found` right after installing nvm | The terminal was open before the installation: open a new one, or run `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`. |
| `npm install -g databrief` fails with `EACCES: permission denied, mkdir '/usr/local/lib/node_modules/...'` | npm's global folder belongs to root. Do not use `sudo npm`: install Node with nvm (above), whose global folder is yours, or run `npx databrief FILE` without installing. |
| `bash: /home/you/.nvm/.../bin/databrief: No such file or directory` after switching from npm to the `.deb` (or back) | The shell remembers the old place of the command. Run `hash -r`, or open a new terminal. `which databrief` shows the one in use. |
| The `.deb` is installed but the tool says it needs Node.js 18 | The `.deb` uses the first `node` of your `PATH`. On a system whose own Node is older than 18, install a newer one (nvm, NodeSource) and make sure `node -v` in the terminal that runs `databrief` says 18 or more. |
| `Cannot create the folder .../databrief: EACCES` (with `--csv`, `--out` or `--review`) | The tool writes in `./databrief`, inside the current folder, and you cannot write there (a project folder created by Docker or `root`, a system folder). Give a folder of yours: `databrief FILE --review --out ~` (an absolute path that exists). |
| `--review` says it needs a terminal | The editor needs a real terminal: from a script, a pipe or an AI agent's shell use `--csv` or `--out` and edit `prompt.md` yourself. |
| `Copied to the clipboard` does nothing on Linux | Install `wl-copy` (Wayland), `xclip` or `xsel`. On WSL the tool uses `powershell.exe` and needs nothing. |
| `scoop install databrief` installs Node.js and 7-Zip | Scoop's `nodejs-lts` needs 7-Zip to unpack: they are the tool's dependencies, nothing else is added. |

## Examples

```bash
# a spreadsheet, no data in the prompt, to ask an AI how to analyse it
databrief survey.xlsx --no-share

# level 2 (adds counts), without the column names
databrief survey.xlsx --no-share=2 --hide=names

# a database dump: prompt.md and one CSV per table, the prompt asks the AI to load them
databrief dump.sql --mode files --csv

# a big file: the first rows that fit
databrief events.parquet --limit auto

# for a program
databrief report.pdf --json --no-copy | jq -r .prompt
```

## See also

[The manual page](../man/databrief.1) (`man -l man/databrief.1`) · [Do not share data](no-share.md) ·
[The formats](../README.md#supported-formats) · [Check the page yourself](verify-privacy.md)
