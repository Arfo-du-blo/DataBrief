# DataBrief

DataBrief turns a data file (CSV, Excel, Parquet, SQLite, SQL or PostgreSQL dumps, JSON, PDF, Word and many more formats) into a prompt that describes it: the tables,
columns, types, keys and statistics, and the data itself only when you allow it ("Do not share data" keeps every record out).

## Use it

- **In a chat:** ask Claude to open DataBrief. The page appears in the conversation; pick your file in it and use its buttons to put the prompt in the chat, add it to the
  context, or ask a question about the data. This uses the DataBrief connector, which you add from the plugin's Connectors tab.
- **With a file Claude can read** (Claude Code, Cowork, or a chat with code execution): `/databrief:databrief path/to/file`, or just say "describe sales.xlsx with DataBrief".
  Claude asks only whether the data may be shared, and runs the tool bundled in the plugin, offline. It needs Node.js 18 or newer.

## What data it sends

The connector (`{{MCP_HOST}}`) serves the DataBrief page and nothing else: it never receives your files, stores nothing and logs only request names, timings and the name of
the calling app, never content or IP addresses. The page reads your file in your browser; only what you choose to put in the chat leaves the page. The bundled tool runs on the machine
where Claude runs code, reads the file there, opens no connection and writes nothing.

Privacy: the same statement is published at https://github.com/Arfo-du-blo/DataBrief/blob/main/docs/plugin.md#what-data-it-sends

Version {{VERSION}}. Free software, GPL-3.0-or-later: https://github.com/Arfo-du-blo/DataBrief
