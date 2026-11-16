---
name: move
description: Move this machine's agent homes to the agentlayer plugin, one or several at once. Previews each move, reviews which mentions of the old name are someone else, notes the sessions to continue, saves a move note, and hands over the exact command to run. Nothing is moved or deleted until the operator runs it. Use when the operator says "move to agentlayer", "move to Oppi", "migrate my home", or sync or the banner offers the move.
allowed-tools: AskUserQuestion, Bash, Read, mcp__plugin_agent-kevin_kevin__report_write
disable-model-invocation: true
---

# Move to agentlayer

agentlayer is the plugin that replaces this one. A move **copies** a home into a new folder and changes only the copy: the old home stays exactly as it was, and going back is one line. This skill prepares each move with the operator and ends in commands they run themselves, because writing outside this home needs their own terminal.

The plugin root is `${CLAUDE_PLUGIN_ROOT}`. Write every command you hand over with that path spelled out.

## 1. Find the homes

```bash
bun "${CLAUDE_PLUGIN_ROOT}/skills/move/scripts/homes.ts"
```

Every home this plugin is installed for on this machine, plus the one you're in: `name`, `version`, `movedTo`, `install` (`dev` loads the plugin from a `checkout`, `marketplace` from the published catalog). Leave out homes with `movedTo` set (say where each went). Ask which to move with `AskUserQuestion` (`multiSelect`, label = agent name, description = folder). Test or probe folders appear too; the operator simply doesn't pick them.

A picked home whose `version` isn't `installed` must be upgraded first: tell the operator to open it and run `/agent-kevin:upgrade`, and carry on with the others.

## 2. Per home: name and folder

One `AskUserQuestion` per home:

- **Name:** keep the current one, or a new one. For an agent named Kevin, offer **Oppi** first (the new plugin's octopus).
- **Folder:** `~/Documents/Agents/<new name>` unless they want another. It must not exist yet.

Oppi gets `--emoji 🐙 --avatar "${CLAUDE_PLUGIN_ROOT}/assets/oppi-avatar.png"`. Any other name keeps its emoji and avatar unless the operator gives new ones.

## 3. Per home: preview and keep review

Run the preview from that home's folder, with the session's own `AGENT_*` paths cleared so the home's settings decide them (`migrate` refuses a home other than the folder it runs from). It writes nothing anywhere:

```bash
P=$(mktemp "${TMPDIR:-/tmp}/move-preview-XXXXXX") && ( cd "<home>" && env -u AGENT_HOME -u AGENT_KNOWLEDGE -u AGENT_PROJECTS -u AGENT_REPORTS bun "${CLAUDE_PLUGIN_ROOT}/bin/kevin" migrate --to "<new folder>" --name "<new name>" <emoji and avatar flags> ) > "$P"; bun "${CLAUDE_PLUGIN_ROOT}/skills/move/scripts/keep-candidates.ts" "$P"
```

It prints the blockers, every line the agent's rename would change and every line the plugin's rename would change (`path:line | text`), the values the settings still use under the old plugin's name, lines left as written for review, and lines kept for the operator to rewrite. The preview's own JSON (`$P`) also names the history folders (`history.from`, `history.to`): keep them for the move note.

**Read every renamed line for meaning, in both rename sections.** The rename is right when the old name means this agent or this plugin. It is wrong, and the line needs `--keep <path>:<line>`, when the old name is:

- another person ("Kevin Moreau", a byline);
- someone else's agent ("Ada's Kevin", "the acme team's Scout"), unless that agent moves to the same new name: once Ada's Kevin is Oppi, "Ada's Kevin" renames in a home taking Oppi (ask the operator when unsure);
- an account, workspace, role or product name ("Agent Kevin" as a support-desk role or a terminal workspace), and any login the settings still use: a line naming a value listed under "Still used by the settings" (a helpdesk username `agent-kevin`) is a keep;
- a document as it was sent or signed: a contract, an invoice, a filing, a reply already sent;
- a title or quotation of something outside this home;
- history that would turn false: what the agent was called then (an old bot's name, a message it signed and sent, "a renamed Kevin" describing another agent's origin), a dated attribution ("first draft by Kevin, 2026-04-26"), or a fact about the old plugin ("every home on `agent-kevin` reads `KEVIN_*`").

A whole document about the old agent's past (a "v1" architecture write-up, research it requested back then) or about the move itself (a runbook, the task tracking the move) takes `--keep <path>`, no line number: its text stays as written, and only a task's assignee moves.

When unsure, it's a keep: a kept line can be edited by hand later, while a wrong rename reads as nonsense. Show the proposed keeps as a table (line, text, why) and let the operator add or drop any. In a home whose agent isn't the one named in a line (Scout mentioning a "Kevin"), the "left as written" lines are already kept; confirm none of them actually means this agent.

Run the preview again with the `--keep` flags. It should have no blockers. Anything else, explain it and stop for that home.

## 4. Sessions to pick up first

Every session stays reachable after the move; this step only chooses which ones the new home offers on its first start. Say so before listing anything, in words like these:

> Nothing is lost here: in the new home you can pick up any past session at any time. Ask for it by its id or by what it worked on ("pick up the timetable session"), and the agent finds it in the brain and loads its notes, so you carry on where it stopped. The one thing that stays behind is `claude --resume`: Claude Code keeps transcripts by folder, so an old transcript resumes only from the old folder. This list just sets which sessions the new home offers you first. Pick any, or none.

Do this while the operator's sessions are still open. List the last week's sessions across every picked home (the attention skill's checkpoint only looks at this home and the last day):

```bash
bun "${CLAUDE_PLUGIN_ROOT}/skills/attention/scripts/list_sessions.ts" --hours 168 --scope "<home>,<home>"
```

Show them as a numbered list grouped by home: title, how long ago, and one line on where it stopped (from `last_assistant_text`). Ask which ones to have offered first (a list this long doesn't fit a four-option question). For each pick, propose the next step from where it stopped and let them correct it.

## 5. Save a move note per home

`report_write` with `category: plans`, `skill: move`, title `Move <old name> → <new name>`, here in the current home (never write into another home). The body:

- **From → to:** the old folder and the new one, the old and new name, and both history folders (`history.from` and `history.to` from the preview; the old one is deleted at retirement, the new one on a start-over).
- **Sessions to continue:** the picks from step 4, as a table of session id, what it was doing, next step. The welcome offers these first; any other session can still be picked up later by asking for it.
- **Kept lines:** each `path:line`, its text, and why.
- **The command:** the exact final command (step 6).
- **After the command:** the checklist below, as `- [ ]` items with this home's real paths, marketplace and commands filled in. Leave out what doesn't apply (the Codex items in a home without `.codex/hooks.json`, the auto-mode item when `~/.claude/settings.json` has no `autoMode` block). Step 1 tells the operator to close this session, so the note is the only copy of these steps that survives it: put every step in the note, not just in the reply.

The tool returns the note's absolute `path`: that, not `relPath`, goes in the final command, since the command runs from the home being moved. The new home's first session reads the note to greet the operator, offer those sessions, and walk through what's left of the checklist.

### The checklist

1. **Close every session in this home**, the one running this skill included. Exiting saves each session's last turns to the brain. Don't sync first: sync compiles into the very files the line keeps point at, and moves their lines. Everything since the last sync comes across with the move, and the new home's first sync compiles and commits it.
2. **Run the command in your own terminal** (not Claude Code). `--retire` marks the old home as moved, so its sessions say so and its sync stops committing.
3. **Install agentlayer for the new folder only**, in the same terminal, so its first open already has it. `--scope local` keeps it out of the old home; the whole-account default would load it there too.
   - `install: dev`: `cd "<new folder>" && claude plugin install agentlayer --marketplace "<agentlayer-agent checkout>" --scope local`. The checkout is `agentlayer-agent` in the same folder as the home's `checkout`; the preview blocks until it exists, so clone it there first (or pass `--checkout <path>` to the move).
   - `install: marketplace`: `cd "<new folder>" && claude plugin install agentlayer@agentlayer --scope local`.
4. **Codex** (a home with `.codex/hooks.json`). Codex registers plugins for the whole account. The move already switched the old plugin off in the new home's `.codex/config.toml`; add agentlayer once: `codex plugin marketplace add "<agentlayer-agent checkout>"` then `codex plugin add agentlayer@agentlayer-dev` for a dev install; `codex plugin add agentlayer@agentlayer` for a marketplace install, whose marketplace is already added. From then on, a home still on the old plugin loads both in Codex: add `[plugins."agentlayer@<marketplace>"]` with `enabled = false` to that home's `.codex/config.toml` until it moves.
5. **Open the new folder.** The welcome greets you as the new agent, checks the move, upgrades and syncs, and offers the sessions above. If `/plugin` doesn't list agentlayer, the install didn't land: run it again, then reopen.
6. **Auto mode** (when `~/.claude/settings.json` has an `autoMode` block). Its `environment` entry starting "Agent homes:" lists the homes the custom rules apply to: add `<new folder>` and keep the others. Until then, routine writes in the new home aren't treated as agent-home work.
7. **Repoint the rest** at the new folder: the Obsidian vault (open `<new folder>` as a vault), terminal and cmux workspaces, and anything else opened from the old path. Run helpdesk and Slack routines from one home only, since the copy holds the same credentials.
8. **Retire the old home**, once you've worked in the new one for a while:
   - Claude Code: `cd "<old folder>" && claude plugin uninstall agent-kevin@<marketplace> --scope local`, and again with `--scope project` if `/plugin` there still lists it. When no home is left on it and it came from a checkout: `claude plugin marketplace remove <marketplace>`.
   - Codex: in `~/.codex/config.toml`, delete `[projects."<old folder>"]` and the four `[hooks.state."<old folder>/.codex/hooks.json:…"]` tables. When no home is left on the old plugin: `codex plugin remove agent-kevin@<marketplace>`, and for a dev install `codex plugin marketplace remove <marketplace>` (a marketplace install keeps its marketplace: agentlayer comes from the same one).
   - Remove the old vault from Obsidian's vault list.
   - Last, delete `<old folder>` and its history folder (`<old history folder>`) by hand.
9. **Going back** (instead of 8): delete the `"movedTo"` line from the old home's `.state/version.json`. **Starting over:** delete the new folder and the new history folder, remove `"movedTo"`, and run this skill again; anything done in the new home since the move is lost, so most problems are better fixed in the new home.

## 6. Hand over, one home at a time

The final command for each home, with every path absolute, written in full:

```
cd "<home>" && env -u AGENT_HOME -u AGENT_KNOWLEDGE -u AGENT_PROJECTS -u AGENT_REPORTS bun "${CLAUDE_PLUGIN_ROOT}/bin/kevin" migrate --to "<new folder>" --name "<new name>" <emoji and avatar flags> <--keep flags> --welcome "<move note path>" --apply --retire
```

Then give the note's checklist as written, with the note's absolute path above it and this line: "This session closes in step 1, so keep the note open; it holds every step, and the new home walks through what's left."
