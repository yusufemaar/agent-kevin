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

It prints the blockers, every line the rename would change (`path:line | text`), lines left as written for review, and lines kept for the operator to rewrite. The preview's own JSON (`$P`) also names the new history folder (`history.to`): keep it for the move note.

**Read every renamed line for meaning.** The rename is right when the old name means this agent or this plugin. It is wrong, and the line needs `--keep <path>:<line>`, when the old name is:

- another person ("Kevin Moreau", a byline);
- someone else's agent ("Ada's Kevin", "the acme team's Scout");
- an account, workspace, role or product name ("Agent Kevin" as a support-desk role or a terminal workspace);
- a title or quotation of something outside this home;
- history that would turn false: what the agent was called then (an old bot's name, a message it signed and sent, "a renamed Kevin" describing another agent's origin), or a dated attribution ("first draft by Kevin, 2026-04-26").

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

- **From → to:** the old folder and the new one, the old and new name, and the new history folder (`history.to` from the preview).
- **Sessions to continue:** the picks from step 4, as a table of session id, what it was doing, next step. The welcome offers these first; any other session can still be picked up later by asking for it.
- **Kept lines:** each `path:line`, its text, and why.
- **The command:** the exact final command (below).

The tool returns the note's absolute `path`: that, not `relPath`, goes in the final command, since the command runs from the home being moved. The new home's first session reads the note to greet the operator and offer those sessions.

## 6. Hand over, one home at a time

The final command for each home, with every path absolute, written in full:

```
cd "<home>" && env -u AGENT_HOME -u AGENT_KNOWLEDGE -u AGENT_PROJECTS -u AGENT_REPORTS bun "${CLAUDE_PLUGIN_ROOT}/bin/kevin" migrate --to "<new folder>" --name "<new name>" <emoji and avatar flags> <--keep flags> --welcome "<move note path>" --apply --retire
```

Then, per home, in order:

1. **In that home:** exit every session there, the one running this skill included. Exiting saves each session's last turns to the brain. Don't sync first: sync compiles into the very files the line keeps point at, and moves their lines. Everything since the last sync comes across with the move, and the new home's first sync compiles and commits it.
2. **In their own terminal** (not Claude Code): the command above. `--retire` marks the old home as moved, so its sessions say so and its sync stops committing.
3. **In the same terminal, install the new plugin for the new folder only**, so its first open already has it:
   - `install: dev`: `cd "<new folder>" && claude plugin install agentlayer --marketplace "<agentlayer-agent checkout>" --scope local`. The checkout is `agentlayer-agent` in the same folder as the home's `checkout`; the preview blocks until it exists, so clone it there first (or pass `--checkout <path>` to the move).
   - `install: marketplace`: `cd "<new folder>" && claude plugin install agentlayer@agentlayer --scope local`.

   `--scope local` installs it for that folder alone; the whole-account default would also load it in the old home.
4. **Open the new folder.** The welcome greets the operator as the new agent, finishes the move (the upgrade, then a first sync in the new home), and offers the sessions picked in step 4. If `/plugin` doesn't list agentlayer, the install didn't land: run it again, then reopen.
5. **Point the rest at the new folder:**
   - **Auto mode:** if `~/.claude/settings.json` has an `autoMode` block, its `environment` entry starting "Agent homes:" lists the homes the custom rules apply to. Add the new folder's path there and keep the others; the welcome's upgrade flags it too. Until then, routine writes in the new home aren't treated as agent-home work.
   - The Obsidian vault, terminal workspaces, and anything else opened from the old path.

Say also:

- **Going back:** delete the `"movedTo"` line from the old home's `.state/version.json`.
- **Starting over:** delete the new folder and the history folder the move note names, remove `"movedTo"`, and run this skill again. Anything done in the new home since the move is lost, so most problems are better fixed in the new home.
- **Helpdesk and Slack routines:** run them from one home only, since the copy holds the same credentials.
