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

Run the preview again with the `--keep` flags. Its only blocker should be "the home has changes its history has not committed (…); run sync first", or none. Anything else, explain it and stop for that home.

## 4. Sessions to continue

Claude Code's old sessions can't be resumed from the new folder, but the brain holds them, and the new home can pick them up. Do this while the operator's sessions are still open. List the last week's sessions across every picked home (the attention skill's checkpoint only looks at this home and the last day):

```bash
bun "${CLAUDE_PLUGIN_ROOT}/skills/attention/scripts/list_sessions.ts" --hours 168 --scope "<home>,<home>"
```

Show them as a numbered list grouped by home: title, how long ago, and one line on where it stopped (from `last_assistant_text`). Ask the operator to name the ones to continue (a list this long doesn't fit a four-option question), and whether any ongoing session is older than a week. For each pick, propose the next step from where it stopped and let them correct it.

## 5. Save a move note per home

`report_write` with `category: plans`, `skill: move`, title `Move <old name> → <new name>`, here in the current home (never write into another home). The body:

- **From → to:** the old folder and the new one, the old and new name, and the new history folder (`history.to` from the preview).
- **Sessions to continue:** a table of session id, what it was doing, next step.
- **Kept lines:** each `path:line`, its text, and why.
- **The command:** the exact final command (below).

The tool returns the note's absolute `path`: that, not `relPath`, goes in the final command, since the command runs from the home being moved. The new home's first session reads the note to greet the operator and offer those sessions.

## 6. Hand over, one home at a time

The final command for each home, with every path absolute, written in full:

```
cd "<home>" && env -u AGENT_HOME -u AGENT_KNOWLEDGE -u AGENT_PROJECTS -u AGENT_REPORTS bun "${CLAUDE_PLUGIN_ROOT}/bin/kevin" migrate --to "<new folder>" --name "<new name>" <emoji and avatar flags> <--keep flags> --welcome "<move note path>" --apply --retire
```

Then, per home, in order:

1. **In that home:** `/agent-kevin:sync`, then exit every session there, the one running this skill included. Each exit saves that session's last turns to the brain's session logs after the sync; the move accepts those (and Obsidian's own settings) uncommitted, carries them across and commits them in the new home. Anything else still unsynced stops the move with "run sync first".
2. **In their own terminal** (not Claude Code): the command above. `--retire` marks the old home as moved, so its sessions say so and its sync stops committing.
3. **Open the new folder** with Claude Code, accept the trust prompt, and install the new plugin there if `/plugin` doesn't list it yet, choosing the scope for this folder only (never the whole account, or it also loads in the old home):
   - `install: dev`: the new plugin's checkout is `agentlayer-agent` in the same folder as the home's `checkout` (the preview blocks until it exists, so clone it there first, or pass `--checkout <path>` to the command). Then `/plugin marketplace add <that checkout>` and `/plugin install agentlayer@agentlayer-dev`.
   - `install: marketplace`: `/plugin install agentlayer@agentlayer`.
4. **Exit and open the folder again.** A plugin's hooks start with a session, so the welcome comes on this second start: it greets the operator as the new agent, finishes the move (the upgrade, then a first sync in the new home), and offers the sessions to continue.
5. **Point the rest at the new folder:** the Obsidian vault, terminal workspaces, and anything else opened from the old path.

Say also:

- **Going back:** delete the `"movedTo"` line from the old home's `.state/version.json`.
- **Starting over:** delete the new folder and the history folder the move note names, remove `"movedTo"`, and run this skill again. Anything done in the new home since the move is lost, so most problems are better fixed in the new home.
- **Helpdesk and Slack routines:** run them from one home only, since the copy holds the same credentials.
