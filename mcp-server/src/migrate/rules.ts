/**
 * The text rules `migrate` applies to a home's copy: plugin names to the new plugin's, the agent's
 * old name to its new one, and paths that name the old home, checkout or history to the new ones.
 * Pure: every rule maps a string to a string, so the dry run and the copy run the same code.
 */
import { renameAgent } from '@/shared/agent-name';

/** The plugin a home moves to, fixed in this release: the old plugin never reads the new one's files. */
export const TARGET = {
  plugin: 'agentlayer',
  server: 'agent',
  marketplace: 'agentlayer',
  devMarketplace: 'agentlayer-dev',
  stateFolder: 'agentlayer',
  checkout: 'agentlayer-agent',
  repo: 'AgentLayer1/agentlayer-agent'
} as const;

export const SOURCE = {
  plugin: 'agent-kevin',
  server: 'kevin',
  devMarketplace: 'agentdev-kevin',
  stateFolder: 'agent-kevin',
  repo: 'AgentLayer1/agent-kevin'
} as const;

/** One old path and its replacement, each in absolute and `~/` spellings. */
export interface PathMove {
  from: string;
  to: string;
}

export interface RuleContext {
  /** The old home, the old checkout and the old history folder, each with where it goes. */
  paths: PathMove[];
  /** The old home: outside a fenced block, a path into it becomes home-relative. */
  home: PathMove;
  /** The agent's name in IDENTITY.md and the one it takes, when it changes. */
  rename?: { from: string; to: string };
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A path ends at a separator, a quote, whitespace, punctuation or the end, never mid-name. */
const pathPattern = (path: string): RegExp => new RegExp(`(?<![\\w./-])${escape(path)}(?=$|[/\\\\,:;\\s"'\`)\\]>*|])`, 'g');

/** Both spellings of a path under the user's home: absolute and `~/`. */
export const spellings = (path: string, userHome: string): string[] =>
  path.startsWith(`${userHome}/`) ? [path, `~${path.slice(userHome.length)}`] : [path];

/** Every spelling of each move, longest first so a nested path is never cut by its parent. */
const expand = (moves: PathMove[], userHome: string): PathMove[] =>
  moves
    .flatMap(({ from, to }) =>
      spellings(from, userHome).map((spelling) => ({
        from: spelling,
        to: spelling.startsWith('~') ? (spellings(to, userHome)[1] ?? to) : to
      }))
    )
    .sort((left, right) => right.from.length - left.from.length);

/** Rewrite every listed path in a string, whichever spelling it uses. */
export const movePaths = (text: string, moves: PathMove[], userHome: string): string =>
  expand(moves, userHome).reduce((out, { from, to }) => out.replace(pathPattern(from), to), text);

/** Plugin names and ids, in the order that keeps a longer form from being cut by a shorter one. */
const PRODUCT: readonly [RegExp, string][] = [
  [/mcp__plugin_agent-kevin_kevin__/g, `mcp__plugin_${TARGET.plugin}_${TARGET.server}__`],
  [/mcp__plugin_agent-kevin_/g, `mcp__plugin_${TARGET.plugin}_`],
  [/agent-kevin@agentdev-kevin/g, `${TARGET.plugin}@${TARGET.devMarketplace}`],
  [/(?<![\w-])agentdev-kevin(?![\w-])/g, TARGET.devMarketplace],
  [/agent-kevin@/g, `${TARGET.plugin}@`],
  [/agent-kevin:/g, `${TARGET.plugin}:`],
  [/AgentLayer1\/agent-kevin(?![\w-])/g, TARGET.repo],
  [/\.local\/state\/agent-kevin\//g, `.local/state/${TARGET.stateFolder}/`],
  [/(?<![\w-])bin\/kevin(?![\w-])/g, 'src/cli.ts'],
  [/(?<![-\w/@.])agent-kevin(?![-\w])/g, TARGET.plugin],
  // "Kevin" meaning the plugin: a version or a commit.
  [/(?<![\w-])Kevin(?= v?\d+\.\d+\.\d+)/g, TARGET.plugin],
  [/(?<![\w-])Kevin(?= `[0-9a-f]{7,40}`)/g, TARGET.plugin]
];

/** The plugin's names in a line, mapped to the new plugin's. */
export const productText = (text: string): string =>
  PRODUCT.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);

/**
 * One file's text with every rule applied. In a fenced code block a path to the old home becomes the
 * new home's, since a command keeps its absolute `cd`; elsewhere it becomes home-relative.
 */
export const migrateText = (text: string, context: RuleContext, userHome: string, keep: ReadonlySet<number>): string => {
  const others = context.paths.filter((move) => move.from !== context.home.from);
  const fence = /^\s*(```|~~~)/;
  let fenced = false;
  return text
    .split('\n')
    .map((line, index) => {
      if (fence.test(line)) {
        fenced = !fenced;
      }
      if (keep.has(index + 1)) {
        return line;
      }
      const relocated = fenced
        ? movePaths(line, context.paths, userHome)
        : movePaths(homeRelative(line, context.home.from, userHome), [...others, context.home], userHome);
      const product = productText(relocated);
      return context.rename ? renameAgent(product, context.rename.from, context.rename.to) : product;
    })
    .join('\n');
};

/**
 * A path into the home written out in full becomes the path inside it. A markdown link target is
 * left whole: it resolves from the linking file's folder, so the next rule points it at the new home.
 */
export const homeRelative = (line: string, home: string, userHome: string): string =>
  spellings(home, userHome).reduce(
    (out, spelling) => out.replace(new RegExp(`(?<![\\w./(-])${escape(spelling)}/(?=\\S)`, 'g'), ''),
    line
  );

/** A task's `assignee` naming the old server key names the new one; only the frontmatter is read. */
export const taskAssignee = (text: string): string => {
  const end = text.startsWith('---\n') ? text.indexOf('\n---', 4) : -1;
  if (end === -1) {
    return text;
  }
  const front = text
    .slice(0, end)
    .replace(/^(assignee:\s*\[)([^\]]*)(\])/m, (_, open: string, list: string, close: string) =>
      `${open}${list
        .split(',')
        .map((item) => (item.trim() === SOURCE.server ? item.replace(SOURCE.server, TARGET.server) : item))
        .join(',')}${close}`
    )
    .replace(/^(assignee:\s*\n(?:\s+-\s+.*\n?)*)/m, (block: string) =>
      block.replace(new RegExp(`^(\\s+-\\s+)${SOURCE.server}\\s*$`, 'gm'), `$1${TARGET.server}`)
    );
  return front + text.slice(end);
};
