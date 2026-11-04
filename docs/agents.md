# DataBrief for AI agents (skill and snippet)

For an AI agent that can run commands (Claude Code, Codex, Gemini CLI, Claude in the web with code execution, and similar), DataBrief can be taught in two ways. In both,
the agent runs the [command-line tool](../README.md) itself on your file, asks you only whether the data may be shared, and works from the prompt it gets.

- [The skill](#the-skill)
- [The text to paste in](#the-text-to-paste-in)
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

## Sharing the data or not

The skill and the snippet make the agent ask ONE question, when you have not said: may the data be shared? "No" is **Do not share data**: the prompt has the
structure of the file and no record. Level 1 is structure only (the default), level 2 adds counts, level 3 adds summaries of the columns, which can show real values
such as a minimum or a category name, so the agent uses it only when asked. Everything else has a default.

## Limits you should know

- **An agent that can run commands can often open the file itself.** DataBrief controls what it outputs, not what the agent can read. The skill and the snippet tell the
  agent not to read the contents of the file by other means when you chose not to share the data; that is an instruction, and your agent's own permissions are what
  enforce it. For a file that must never reach the AI, do not give the agent access to it.
- The prompt is data. The skill tells the agent not to follow instructions it finds inside a file; a model can still be fooled, as with any text it reads.
- The commands in the texts are tested (they are run from the unzipped skill on test files), but how an agent follows the instructions depends on the agent, and none has been tested yet. The README lists the applications that were.

## Build it yourself

```bash
node tools/build-agents.cjs        # dist/agents/: databrief-skill.zip, databrief-skill/, AGENTS-snippet.md
```

The texts are `agents/skill/SKILL.md` and `agents/AGENTS-snippet.md`; the version in them is package.json's. `tests/test_agents.cjs` builds twice (same bytes), checks that
every option the texts name exists, and runs the documented commands from the unzipped skill on test files in both modes.
