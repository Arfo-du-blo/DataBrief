# DataBrief for Claude Desktop (extension)

`databrief.mcpb` is an extension for the **Claude Desktop** app (Windows and macOS). It has DataBrief inside and runs on your computer with the Node that
Claude Desktop brings: **nothing to install first, no account, no network access.**

It adds two tools to the chat:

| Tool | What it does |
|---|---|
| **DataBrief** (`databrief_open`) | Shows the DataBrief page inside the chat, as a widget. You pick a file in it, and use its buttons to put the prompt in the chat, add it to the context, or ask a question about the data. Same page as the [hosted connector](mcp-server.md). |
| **Read a file with DataBrief** (`databrief_analyze`) | Claude reads a file **by its path** on your computer and gets the prompt, with the same code as the [command-line tool](../README.md). You only have to give it the path. |

- [Install](#install)
- [Use it](#use-it)
- [Sharing the data or not](#sharing-the-data-or-not)
- [Privacy](#privacy)
- [Build it yourself](#build-it-yourself)
- [Remove it](#remove-it)

## Install

1. Download `databrief.mcpb` from the [releases page](https://github.com/Arfo-du-blo/DataBrief/releases).
2. In Claude Desktop open **Settings**, **Extensions**, **Advanced settings**, **Install Extension…** and choose the file. (Double-clicking the file only works when the system has linked `.mcpb` files to Claude Desktop, which it does not always do; on Windows you may only be asked which app to use. Use the Settings route then.)
3. Check the details Claude Desktop shows, and click **Install**. Then turn the extension on.

Tested with Claude Desktop only. Other applications that open `.mcpb` files should work, but have not been tested.

## Use it

- **From a path:** "Describe `C:\Users\me\sales.xlsx` with DataBrief." Claude calls the tool, reads the answer, and works from it. It supports every format the
  command-line tool does (CSV, Excel, Parquet, SQLite, SQL dumps, PostgreSQL archives, JSON, PDF, Word and many more).
- **From the page:** "Open DataBrief." Pick the file in the widget, then use **Put in the chat**, **Add to context** or **Ask about this data**.

## Sharing the data or not

The path tool has a required `share` parameter with no default, so Claude cannot read a file without deciding:

- **`share: "no"`** is **Do not share data**: the prompt describes the file (columns, types, keys, statistics) and holds no record. Level 1 (structure only) is
  the default; "counts" is level 2; "all the statistics" is level 3, whose summaries can show real values such as a minimum or a category name.
- **`share: "yes"`** puts the data itself in the prompt. For a large file, the rows kept are limited automatically so that an AI can read it.

When you have not said which one you want, Claude should **ask you** ("share the data?") and nothing else. If it does not, tell it: "do not share the data".

## Privacy

- The file is read **on your computer**, by a separate process that opens no connection. The extension's code has no network call and no write call (tests check it).
- What the tool returns goes to Claude Desktop, like anything you put in the chat: with `share: "yes"` the data is in the prompt Claude receives. Use "no" when
  the file must stay private.
- **Claude can ask for any path on your computer.** Claude Desktop asks you before it lets a tool run; read the path in that question before you allow it, and
  prefer "allow once" over "always allow" if the file is sensitive.
- The extension logs method names and timings to Claude Desktop's own log, never a path, a file name or any content.

## Build it yourself

```bash
node tools/build-mcpb.cjs        # writes dist/databrief.mcpb
```

The build is reproducible: the same sources give the same bytes, and `tests/test_mcpb.cjs` checks it. It also runs the extension's server from the built file,
asks it for every test file in both modes, and compares each prompt with the command-line tool's.

When the widget changes, the extension's widget address changes with it (`node tools/build-widget.cjs --new-address` moves `extension/uris.json` and
`mcp/uris.json` together); the build stops if they disagree.

## Remove it

In Claude Desktop: **Settings**, **Extensions**, DataBrief, **Uninstall**. Nothing is left on your computer: the extension stores nothing.
