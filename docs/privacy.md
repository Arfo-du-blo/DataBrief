# Privacy policy

This policy covers the **DataBrief connector**: the hosted server that shows the DataBrief page inside Claude, ChatGPT and other chat apps ([what it is](connector.md)), and the project's own page at
<https://databrief.boards.digital/>. It is written for the server run by the author (GitHub: [Arfo-du-blo](https://github.com/Arfo-du-blo)), the controller of what follows. If you run your own copy, you decide what yours does; the code is the
same and it behaves as described here unless you change it.

DataBrief is free software (GPL-3.0-or-later). You can read the code and check each statement below.

- [In one paragraph](#in-one-paragraph)
- [Your files](#your-files)
- [What the server receives and logs](#what-the-server-receives-and-logs)
- [How long it is kept](#how-long-it-is-kept)
- [The plugin, the extension and the command-line tool](#the-plugin-the-extension-and-the-command-line-tool)
- [Who else is involved](#who-else-is-involved)
- [What leaves the page, and when](#what-leaves-the-page-and-when)
- [Children, cookies, tracking](#children-cookies-tracking)
- [Your rights and contact](#your-rights-and-contact)
- [Changes to this policy](#changes-to-this-policy)

## In one paragraph

Your files are read by the DataBrief page **in your browser**, on your computer. The server never receives them. It receives only the chat app's technical requests (which tool, which page), keeps no account, no
conversation and no file, and writes request names and timings to a log without any content or IP address.

## Your files

- You choose a file in the page. The page reads it **locally**, in your browser. The file is not uploaded, and the page makes no network request (its security policy forbids it; you can [check it yourself](verify-privacy.md)).
- The page builds a prompt from the file. With **Do not share data**, the prompt describes the structure and statistics and holds no record (level 3 summaries can show real values such as a minimum or a category name, and the page says so).
- Nothing leaves the page until **you** click a button and **confirm** a second time: Put in the chat, Add to context, or Ask about this data. Then the prompt goes to the chat app you are using, under that app's own privacy policy. Copy and Download stay on your computer.

## What the server receives and logs

The server receives the requests the chat app makes: its handshake, the list of tools, a call of the tool `databrief_open` (which takes no argument), and the request for the page itself. These carry no file and no prompt.

It also receives the requests of a browser that opens its home page (`/`) or the tool (`/app`) directly. Those are plain page requests: the server does **not** log them, and it still never receives your file, which the page reads in your browser.

For each request the server writes one log line with:

- the date and time, the route, the HTTP status and the duration;
- the name of the protocol method (`tools/call`, `resources/read`... any unknown one is logged as `other`, never with the sender's text);
- the tool name, the name the chat app gives itself (letters and digits only, 40 characters at most) and the first word of its user agent.

The log has **no IP address, no header, no cookie, no token, no argument and no content**. To limit abuse, the server keeps the connection's address in memory for at most one minute to count requests, and writes it nowhere.
Tests plant canary values in every possible place and check that they never appear in the log.

The server has no database, no account and no session, and its code has no call that writes a file (a test checks it).

## How long it is kept

Log lines stay on the server's own disk in rotating files of limited size (a few tens of megabytes at most), so the oldest lines disappear as new ones arrive. They are not copied elsewhere, sold or analysed. Nothing else is kept.

## The plugin, the extension and the command-line tool

The [Claude plugin](plugin.md) holds the connector described above and the offline tool. The tool, the Claude Desktop [extension](extension.md) and `databrief --mcp` read a file **on your computer**,
open no connection, write nothing and send nothing anywhere; what they return goes to the app that called them (Claude, an agent), which is yours to choose. They keep no log of file names or contents (their log, when it exists, holds method names and timings).
The plugin's only network address is the connector's.

## Who else is involved

- **The chat apps** (Anthropic for Claude, OpenAI for ChatGPT) call the server from their own cloud and display the page. What you put in the chat is theirs to handle, under their policies.
- **Cloudflare**: the server is reached through a Cloudflare Tunnel. Cloudflare sees the traffic to the server (not your files, which never travel there) and applies its own privacy policy and logs. The connector's server does not add any other service, analytics, advertising or tracking.
- **GitHub**: the project page and the code are hosted on GitHub, which applies its own policy to visitors.

No personal data is sold or shared with anyone else.

## What leaves the page, and when

| Action | What leaves the page | Where it goes |
|---|---|---|
| Choose a file | Nothing | Stays in your browser |
| Copy, Download | Nothing | Your clipboard or your downloads |
| Put in the chat, Add to context, Ask (after the second click) | The prompt, with or without the data as you chose | The chat app you are using |
| Open a link in the page (documentation, GitHub) | Nothing from your file | Your browser, after the app's confirmation |

## Children, cookies, tracking

The connector is not aimed at children and collects no age. The server sets no cookie and the page stores nothing about you. There is no analytics, no advertising and no profiling.

## Your rights and contact

The server holds no personal data about you that could be shown, corrected or deleted: it keeps no account and its log has no identifier. If you think otherwise, or have a question about this policy, ask through [support](support.md)
(an issue is public: do not put private data in it).

## Changes to this policy

Changes are made in this file; its history on GitHub shows every one. A change that matters (for example a new service involved) will be announced in the project's release notes before it applies.
