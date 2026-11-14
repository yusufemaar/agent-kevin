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

Every home this plugin is installed for on this machine: `name`, `version`, `movedTo`, `install` (`dev` loads the plugin from a checkout, `marketplace` from the published catalog). Leave out homes with `movedTo` set (say where each went). Ask which to move with `AskUserQuestion` (`multiSelect`, label = agent name, description = folder). Test or probe folders appear too; the operator simply doesn't pick them.

A picked home whose `version` isn't `installed` must be upgraded first: tell the operator to open it and run `/agent-kevin:upgrade`, and carry on with the others.

## 2. Per home: name and folder

One `AskUserQuestion` per home:

- **Name:** keep the current one, or a new one. For an agent named Kevin, offer **Oppi** first (the new plugin's octopus).
- **Folder:** `~/Documents/Agents/<new name>` unless they want another. It must not exist yet.

Oppi gets `--emoji 🐙 --avatar "${CLAUDE_PLUGIN_ROOT}/assets/oppi-avatar.png"`. Any other name keeps its emoji and avatar unless the operator gives new ones.

## 3. Per home: preview and keep review

Run the preview from that home's folder. It writes nothing anywhere:

```bash
P=$(mktemp "${TMPDIR:-/tmp}/move-preview-XXXXXX") && ( cd "<home>" && bun "${CLAUDE_PLUGIN_ROOT}/bin/kevin" migrate --to "<new folder>" --name "<new name>" <emoji and avatar flags> ) > "$P"; bun "${CLAUDE_PLUGIN_ROOT}/skills/move/scripts/keep-candidates.ts" "$P"
```

It prints the blockers, every line the rename would change (`path:line | text`), lines left as written for review, and lines kept for the operator to rewrite.

**Read every renamed line for meaning.** The rename is right when the old name means this agent or this plugin. It is wrong, and the line needs `--keep <path>:<line>`, when the old name is:

- another person ("Kevin Moreau", a byline);
- someone else's agent ("Ada's Kevin", "the acme team's Scout");
- an account, workspace, role or product name ("Agent Kevin" as a support-desk role or a terminal workspace);
- a title or quotation of something outside this home;
- history that would turn false: what the agent was called then (an old bot's name, a message it signed and sent, "a renamed Kevin" describing another agent's origin), or a dated attribution ("first draft by Kevin, 2026-04-26").

A whole document about the old agent's past (a "v1" architecture write-up, research it requested back then) or about the move itself (a runbook, the task tracking the move) takes `--keep <path>`, no line number: its text stays as written, and only a task's assignee moves.

When unsure, it's a keep: a kept line can be edited by hand later, while a wrong rename reads as nonsense. Show the proposed keeps as a table (line, text, why) and let the operator add or drop any. In a home whose agent isn't the one named in a line (Scout mentioning a "Kevin"), the "left as written" lines are already kept; confirm none of them actually means this agent.

Run the preview again with the `--keep` flags. Its only blocker should be "the home has changes its history has not committed; run sync first", or none. Anything else, explain it and stop for that home.

## 4. Sessions to continue

Claude Code's old sessions can't be resumed from the new folder, but the brain holds them, and the new home can pick them up. Run the attention skill's checkpoint (`/agent-kevin:attention checkpoint all`, or its playbook directly) and list the recent sessions grouped by home folder. Ask which to continue in each new home, and the next step for each.

## 5. Save a move note per home

`report_write` with `category: plans`, `skill: move`, title `Move <old name> → <new name>`, here in the current home (never write into another home). The body:

- **From → to:** the old folder and the new one, the old and new name.
- **Sessions to continue:** a table of session id, what it was doing, next step.
- **Kept lines:** each `path:line`, its text, and why.
- **The command:** the exact final command (below).

The tool returns the note's path. The new home's first session reads it to greet the operator and offer those sessions.

## 6. Hand over, one home at a time

The final command for each home, with every path absolute, written in full:

```
cd "<home>" && bun "${CLAUDE_PLUGIN_ROOT}/bin/kevin" migrate --to "<new folder>" --name "<new name>" <emoji and avatar flags> <--keep flags> --welcome "<move note path>" --apply --retire
```

Then, per home, in order:

1. **In that home:** `/agent-kevin:sync`, then close every session there. Closing saves each session's last turns to the brain.
2. **In their own terminal** (not Claude Code): the command above. `--retire` marks the old home as moved, so its sessions say so and its sync stops committing.
3. **Install the new plugin for the new folder only**, then open it:
   - `install: dev`: `/plugin marketplace add <the agentlayer-agent checkout>` (the preview names it; clone it next to the old checkout if it's missing), then `/plugin install agentlayer@agentlayer-dev`.
   - `install: marketplace`: `/plugin install agentlayer@agentlayer`.
   - Choose the scope for this folder only, never the whole account, or the new plugin also loads in the old home.
4. **Open the new folder.** Its first session greets the operator as the new agent, offers the sessions to continue, and runs `/agentlayer:upgrade`.

Say also:

- **Going back:** delete the `"movedTo"` line from the old home's `.state/version.json`.
- **Starting over:** delete the new folder and its history (`~/.local/state/agentlayer/<folder name>.git`), remove `"movedTo"`, and run this skill again. Anything done in the new home since the move is lost.
- **Helpdesk and Slack routines:** run them from one home only, since the copy holds the same credentials.
