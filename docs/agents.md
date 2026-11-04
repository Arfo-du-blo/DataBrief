# DataBrief for AI agents (skill and snippet)

For an AI agent (Claude Code, Codex, Gemini CLI, Claude in the web with code execution, and similar), DataBrief comes in three forms. In all of them the
[command-line tool](../README.md) reads your file on your machine, the agent asks you only whether the data may be shared, and works from the prompt it gets.

| Form | For | Needs |
|---|---|---|
| The skill | agents that read skills (Claude Code, Claude with code execution) | Node.js 18+, nothing else (the tool is inside) |
| The text to paste in | any agent that can run commands | Node.js 18+; DataBrief installed, or npx (downloads it once) |
| The MCP server, `databrief --mcp` | any agent that speaks MCP, even one that cannot run commands | Node.js 18+; DataBrief installed, or npx |

- [The skill](#the-skill)
- [The text to paste in](#the-text-to-paste-in)
- [The MCP server](#the-mcp-server)
- [Sharing the data or not](#sharing-the-data-or-not)
- [Limits you should know](#limits-you-should-know)
- [Build it yourself](#build-it-yourself)

## The skill

`databrief-skill.zip` (from the [releases page](https://github.com/Arfo-du-blo/DataBrief/releases)) holds a folder `databrief/` with a `SKILL.md` that tells the agent when and how to
use DataBrief, and the whole tool as one file, `scripts/databrief.cjs`. It needs **Node.js 18 or newer** on the machine where the agent runs, and nothing else: no
network, no npm.

- **Claude Code:** unzip it into `~/.claude/skills/` (or a project's `.claude/skills/`), so that `~/.claude/skills/databrief/SKILL.md` exists. Restart the session.
- **Claude (web and Desktop):** Settings, Capabilities, Skills, upload the zip. It works where Claude has code execution, and the file has to be available there
  (attached to the chat).
- **Other agents** that read the skills format: the same folder.

Then say, for example: "Describe `sales.xlsx` with DataBrief."

## The text to paste in

When you cannot install a skill, `AGENTS-snippet.md` is the same instruction in one short block. Paste it into `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` or your agent's rules
file. It uses `databrief` when it is installed (Scoop, Homebrew, the `.deb`, npm), and otherwise `npx -y databrief@VERSION`, pinned to the version of the release, after
asking you, because that downloads the tool from npm.

## The MCP server

`databrief --mcp` runs the tool as a local MCP server on standard input and output. It offers one tool, `databrief_analyze`: the agent gives the
absolute path of a file and `share` (`"yes"` or `"no"`, required, no default), and gets the prompt. It is the same server as in the
[Claude Desktop extension](extension.md), without the page. It starts no program, opens no connection and writes nothing; its log (on standard error) holds
method names and timings, never a path or any content.

**`--root DIR` limits it to one folder:** only files whose real path (links followed) is inside DIR are read, and a file outside gets the same answer as
a missing one. Without it, the agent can ask for any file you can read. The rules:

- A link inside the folder that points outside is refused, and so is a file with a second name elsewhere (a hard link).
- Network paths (`\\host\share`, `//host/share`) are never opened, with or without `--root`.
- `--root` cannot be the root of a disk (`/` or `C:\`): the server stops and says so.
- `--root .` is the folder the agent starts the server in (for most agents, the project's folder). Some apps start servers in another folder (for example `/` on
  macOS, which is refused as a disk root); **write an absolute path** to be sure.

Claude Code:

```bash
claude mcp add databrief -- npx -y databrief@VERSION --mcp --root .
# on Windows: claude mcp add databrief -- cmd /c npx -y databrief@VERSION --mcp --root .
```

Agents with a JSON configuration (`mcp.json` in the release, for example Gemini CLI's `settings.json` or Cursor's `mcp.json`):

```json
{ "mcpServers": { "databrief": { "command": "npx", "args": ["-y", "databrief@VERSION", "--mcp", "--root", "."] } } }
```

On Windows, `npx` is a script (`npx.cmd`), and an app that starts the command without a shell cannot find it. If the server does not start, run it through `cmd`:

```json
{ "mcpServers": { "databrief": { "command": "cmd", "args": ["/c", "npx", "-y", "databrief@VERSION", "--mcp", "--root", "."] } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.databrief]
command = "npx"
args = ["-y", "databrief@VERSION", "--mcp", "--root", "."]
```

On Windows, if Codex cannot start `npx`: `command = "cmd"` and `args = ["/c", "npx", "-y", "databrief@VERSION", "--mcp", "--root", "."]`.

Replace VERSION with the release's version. With DataBrief installed (Scoop, Homebrew, the `.deb`, `npm install -g databrief`), the command is simply
`databrief` with the arguments `--mcp --root .`. Some apps refuse a long tool answer (Claude Code warns above about 25,000 tokens): the tool tells the agent to ask
again with fewer rows or without the data.

## Sharing the data or not

The skill and the snippet make the agent ask ONE question, when you have not said: may the data be shared? "No" is **Do not share data**: the prompt has the
structure of the file and no record. Level 1 is structure only (the default), level 2 adds counts, level 3 adds summaries of the columns, which can show real values
such as a minimum or a category name, so the agent uses it only when asked. Everything else has a default.

## Limits you should know

- **An agent that can run commands can often open the file itself.** DataBrief controls what it outputs, not what the agent can read. The skill and the snippet tell the
  agent not to read the contents of the file by other means when you chose not to share the data; that is an instruction, and your agent's own permissions are what
  enforce it. For a file that must never reach the AI, do not give the agent access to it.
- The prompt is data. The skill tells the agent not to follow instructions it finds inside a file; a model can still be fooled, as with any text it reads.
- A tool that reads a file can be asked for any path in the allowed area, also by text hidden in a file or a web page that the agent reads. `--root` is the
  protection: use it, and give it the folder the agent works in.
- The commands in the texts are tested (they are run from the unzipped skill on test files), but how an agent follows the instructions depends on the agent, and none has been tested yet. The README lists the applications that were.

## Build it yourself

```bash
node tools/build-agents.cjs        # dist/agents/: databrief-skill.zip, databrief-skill/, AGENTS-snippet.md, mcp.json
```

The texts are `agents/skill/SKILL.md`, `agents/AGENTS-snippet.md` and `agents/mcp.json`; the version in them is package.json's. `tests/test_agents.cjs` builds twice (same bytes), checks that
every option the texts name exists, and runs the documented commands from the unzipped skill on test files in both modes.

The same skill, with the hosted connector and a command, is also packaged as a [Claude plugin](plugin.md).
