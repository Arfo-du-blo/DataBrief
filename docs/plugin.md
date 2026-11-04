# DataBrief plugin for Claude

The plugin puts DataBrief in Claude in three pieces, so that people add them together:

- **The connector:** the hosted DataBrief server ([what it is](mcp-server.md)). It shows the DataBrief page inside the chat, as a widget.
- **The skill:** tells Claude when and how to use DataBrief, with the whole tool bundled (`scripts/databrief.cjs`): Claude asks you only whether the data may be shared,
  and reads a file it has access to, offline ([details](agents.md)).
- **The command** `/databrief:databrief <path>` (in Claude Code and Cowork; in chat it works as a skill).

- [Install](#install)
- [What works where](#what-works-where)
- [Build it yourself](#build-it-yourself)
- [What data it sends](#what-data-it-sends)

## Install

1. Download `databrief-plugin.zip` from the [releases page](https://github.com/Arfo-du-blo/DataBrief/releases).
2. In Claude (web or Desktop): **Customize**, **Plugins**, **Add**, **Upload plugin**, and choose the zip. In Claude Code: unzip it and start with `claude --plugin-dir <folder>`.
3. In chat, connect the DataBrief connector from the plugin's **Connectors** tab. It asks for no sign-in.

Then say, for example: "Open DataBrief", or "Describe `sales.xlsx` with DataBrief".

## What works where

| Where | The page (connector) | Reading a file with the bundled tool |
|---|---|---|
| Claude in the browser, Claude Desktop (chat) | yes | only where Claude has code execution and the file is attached |
| Claude Code, Cowork | yes (the connector is loaded) | yes, needs Node.js 18 or newer |

A plugin cannot start a local server in chat: for Claude Desktop with a file **on your computer**, the [extension](extension.md) is the route (Claude reads the path itself).
Skills load everywhere; the tool inside the skill needs a place where Claude can run code.

Tested: Claude (web and Desktop) with the hosted connector and the widget, and the extension. The plugin as one package, the skill and the command have **not** been tested in
every app; see the README for what was.

## Build it yourself

The hosted server's address is not in the repository: you give it when you build, because every plugin installer receives it in `.mcp.json`.

```bash
node tools/build-plugin.cjs --url https://YOUR-HOST/mcp        # dist/plugin/databrief-plugin.zip and the folder
```

The address must be `https`, end with `/mcp` and hold no login, query or fragment. To run your own server, see [Running the hosted MCP server](mcp-operations.md).
The zip has no `bin/` directory (it would stop claude.ai and Cowork from installing the plugin). `claude plugin validate ./databrief-plugin` checks the manifest in Claude Code.
`tests/test_plugin.cjs` builds twice (same bytes), checks the layout, the manifest, `.mcp.json`, the texts and the README, and runs the bundled tool from the unzipped plugin.

## What data it sends

The connector serves the page and nothing else: it never receives your files and logs only request names, timings and the name of the calling app. The page reads your file in
your browser; only what you choose to put in the chat leaves the page. The bundled tool reads the file where Claude runs code, opens no connection and writes nothing. Like
with any tool, an AI that can run commands can often read the file itself: "Do not share data" controls what DataBrief outputs.
