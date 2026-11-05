# The DataBrief connector for Claude and ChatGPT

DataBrief turns a data file (CSV, Excel, Parquet, SQLite, SQL or PostgreSQL dumps, JSON, PDF, Word and [many more formats](../README.md#supported-formats)) into a prompt that describes it:
the tables, columns, types, keys and statistics, and the data itself only when you choose. With **Do not share data**, the prompt holds the structure of the file and not a single record.

The connector shows the DataBrief page **inside the chat**, as a widget. You pick your file in it; the page reads the file **in your browser**, on your computer.

**The connector's server never receives your files.** It serves the page and answers the chat app's requests, and that is all. See the [privacy policy](privacy.md).

- [Add it](#add-it)
- [Use it](#use-it)
- [What each button does](#what-each-button-does)
- [Do not share data](#do-not-share-data)
- [A file to try](#a-file-to-try)
- [What was tested](#what-was-tested)
- [If something does not work](#if-something-does-not-work)

## Add it

In **Claude** (claude.ai, Claude Desktop): open **Settings**, **Connectors**, **Add custom connector**, paste the address of the connector's server (it ends in `/mcp`), and add it. It asks for no sign-in.
When the connector is listed in the directory, you can add it from there instead.

In **ChatGPT**: turn on developer mode in the settings, then add the address as a connector (an app with the address of the server, no authentication).

To run your own copy of the server, see [Running the hosted MCP server](mcp-operations.md). In Claude Desktop you can also install the [extension](extension.md), which has DataBrief inside and needs no server.

## Use it

1. Ask: "Open DataBrief."
2. The DataBrief page appears in the chat. Choose your file in it (or drop it on the page).
3. Pick what you want: put the prompt in the chat, add it to the conversation context, or ask a question about the data (buttons below).
4. Each of these buttons asks for a second click ("Confirm") before anything leaves the page, and says how big the prompt is and whether it holds data.

You can leave the page at any time: nothing has been sent until you confirm.

**Without a chat:** the same server also offers the tool as a normal web page. Open the server's address in a browser, press **Open the tool**, and use DataBrief like the [online version](https://arfo-du-blo.github.io/DataBrief/). The home page also shows the connector address to copy.

## What each button does

| Button | What happens |
|---|---|
| **Put in the chat** | The prompt goes into your message box (Claude) or is sent as your message (ChatGPT). In Claude you press send. |
| **Add to context** | The prompt is added to the conversation context, and a short line asks the AI to read it. Not offered in every app. |
| **Ask about this data** | You type a question; the page adds the prompt to the context and sends the question. |
| **Copy**, **Download** | The prompt as text or Markdown (and the data as CSV or zip when the data is shared), on your computer. |

The page shows only what the app says it supports. Sizes never block: above the limits of the app, a warning is shown, and you can still try.

## Do not share data

Switch **Do not share data** on, on the page, before you use a button: the prompt then describes the file without any of its records.

- **Level 1** (the default): structure only. **Level 2** adds counts. **Level 3** adds summaries of the columns, which can show real values such as a minimum or a category name: the page turns amber and says so.
- The file name, the column names and some other parts can be hidden or shown with the switches on the page.

More: [Do not share data](no-share.md).

## A file to try

[`docs/sample/orders-sample.csv`](sample/orders-sample.csv) is a small file of invented orders, safe to open in any chat. Download it, open DataBrief in the chat, and pick it.

## What was tested

Only **Claude** (in the browser and in Claude Desktop) and **ChatGPT** (in the browser) were tested with the page. Other apps that speak MCP and its MCP Apps extension should work, with the page offering only what the app declares, but none has been tried.

## If something does not work

| What you see | What to do |
|---|---|
| The widget does not appear | The app may not display MCP Apps. Open `databrief.html` from the [project page](https://arfo-du-blo.github.io/DataBrief/) in your browser instead: the same page, the same privacy. |
| A button does nothing the first time | Wait about two seconds after the first click, then confirm. Claude refuses a message sent too soon after a click. |
| An old version of the widget shows | Remove the connector and add it again: apps keep a widget for each address. |
| The connector cannot connect | The server may be down. Try again later, or [ask for help](support.md). |

Other questions or a bug: [support](support.md).
