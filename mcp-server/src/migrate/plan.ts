/**
 * What `migrate` would write: every file of the new home whose text changes, computed from the old
 * home without touching it. The dry run prints this plan; `apply` copies the home and writes it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { FORMERLY_FIELD, NAME_FIELD, NAME_RE, agentNameIn, formerNamesIn } from '@/shared/agent-name';
import { RUNTIME_DIR } from '@/shared/naming';
import { todayDate } from '@/shared/date';
import { ENTRY_SPLIT_RE } from '@/knowledge/session-format';
import { canonicalPath, recordedGitDir } from '@/home/git-dir-record';
import { type PathMove, type RuleContext, SOURCE, TARGET, migrateText, productText, taskAssignee } from './rules';
import { isInside } from '@/shared/paths';
import { type JsonObject, leftovers, migrateCodexConfig, migrateCodexHooks, migrateSettings } from './settings';

export interface MigrateOptions {
  /** The home to move, and the folder it moves to (which must not exist yet). */
  home: string;
  to: string;
  /** The note the new home's first session greets with (sessions to continue, the keep list), copied in when it lives elsewhere. */
  welcome?: string;
  /** The agent's new name, emoji and avatar image; each kept when absent. */
  name?: string;
  emoji?: string;
  avatar?: string;
  /** What the rename leaves as written: `path:line` for a person or product that shares the name, `path` for a whole file. */
  keep: string[];
  userHome: string;
  /** This plugin's version: the home must be upgraded to it first. */
  pluginVersion: string;
  /** The new plugin's checkout, for a home that loads the old one from a checkout. */
  checkout?: string;
  /** The checkout this command runs from, when it is one: the home may name it without a marketplace entry. */
  sourceCheckout?: string;
  /** The folders the home's knowledge, projects and reports resolve to: each must be the home's own. */
  roots: { knowledge: string; projects: string; reports: string };
  /** Where Claude Code keeps transcripts by launch folder, and where history folders live. */
  claudeProjects: string;
  stateRoot: string;
}

export interface Edit {
  path: string;
  text: string;
}

export interface LineChange {
  path: string;
  line: number;
  before: string;
  after: string;
}

export interface Plan {
  from: string;
  to: string;
  blockers: string[];
  edits: Edit[];
  deletes: string[];
  copies: { from: string; to: string }[];
  history: { from: string; to: string } | null;
  transcripts: string[];
  report: {
    agent: { name: string; formerly: string[]; emoji?: string; avatar?: string };
    persona: LineChange[];
    product: LineChange[];
    other: Record<string, number>;
    review: LineChange[];
    leftovers: string[];
    manual: string[];
  };
}

const IDENTITY = 'IDENTITY.md';
const ROOT_FILES = ['SOUL.md', IDENTITY, 'AGENTS.md', 'USER.md', join('.claude', 'CLAUDE.md')];
const TREES = [join('.claude', 'rules'), 'knowledge', 'projects'];
const DATED = [join('knowledge', 'raw'), join('projects', 'TASKS.md')];
const DAILY = /^\d{4}-\d{2}-\d{2}\.md$/;
const THREAD = /^## Thread[ \t]*$/m;
/** A line about the mascot the old name came from: renaming it would only produce nonsense. */
const MASCOT = /\bminions?\b/i;
const SESSIONS = join('knowledge', 'raw', 'sessions');
/** The heading a day-log entry opens with, and the first eight characters of its session's id. */
const ENTRY_ID = /^### (?:Session|Pre-Compact) \([^)]*\) \[([0-9a-f]{8})/m;
const SETTINGS = [join('.claude', 'settings.json'), join('.claude', 'settings.local.json'), '.mcp.json'];
const CODEX_CONFIG = join('.codex', 'config.toml');
const CODEX_HOOKS = join('.codex', 'hooks.json');
const CODEX_RULES = join('.codex', 'rules', `${SOURCE.server}.rules`);
const TEMPLATE_BASE = join(RUNTIME_DIR, 'template-base');
const CADENCE = join(RUNTIME_DIR, 'cadence.json');
const MANUAL_TREES = [join('.claude', 'skills'), 'scripts'];

const lstat = (path: string) => lstatSync(path, { throwIfNoEntry: false });

/** Every file under `rel` in `home`, skipping dot-entries and symlinks; `markdown` keeps `.md` only. */
const filesUnder = (home: string, rel: string, skip: (rel: string, name: string) => boolean, markdown = true): string[] =>
  lstat(join(home, rel))?.isDirectory()
    ? readdirSync(join(home, rel), { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => (left.name < right.name ? -1 : 1))
        .flatMap((entry) => {
          const child = join(rel, entry.name);
          if (skip(child, entry.name)) {
            return [];
          }
          if (entry.isDirectory()) {
            return filesUnder(home, child, skip, markdown);
          }
          return entry.isFile() && (!markdown || entry.name.endsWith('.md')) ? [child] : [];
        })
    : [];

/** The text the rename may rewrite: what the agent reads now, never a dated record. */
const curated = (home: string): string[] => [
  ...ROOT_FILES.filter((rel) => lstat(join(home, rel))?.isFile()),
  ...TREES.flatMap((tree) =>
    filesUnder(
      home,
      tree,
      (rel, name) =>
        DATED.includes(rel) || name === 'archive' || (rel.startsWith(join('knowledge', 'memory')) && DAILY.test(name))
    )
  )
];

const taskFiles = (home: string): string[] =>
  filesUnder(home, 'projects', () => false).filter((rel) => rel.split(sep).includes('tasks') && basename(rel) !== 'TASKS.md');

/** The file's text, or null when it isn't clean UTF-8 and a rewrite would mangle it. */
const textOf = (path: string): string | null => {
  const buffer = readFileSync(path);
  const text = buffer.toString('utf-8');
  return Buffer.from(text, 'utf-8').equals(buffer) ? text : null;
};

const posix = (rel: string): string => rel.split(sep).join('/');

const lineChanges = (path: string, before: string, after: string): LineChange[] => {
  const old = before.split('\n');
  return after.split('\n').flatMap((line, index) =>
    line === old[index] ? [] : [{ path: posix(path), line: index + 1, before: (old[index] ?? '').trim(), after: line.trim() }]
  );
};

/** A home's location as a history folder name: its path under the user's home, separators as dashes. */
export const historyName = (home: string, userHome: string): string =>
  (home.startsWith(`${userHome}/`) ? relative(userHome, home) : home)
    .split(sep)
    .filter(Boolean)
    .join('-')
    .replace(/[^A-Za-z0-9._-]+/g, '-') || 'home';

/** The history folder a home is bound to: the recorded one, the `.git` file's target, or none. */
const historyOf = (home: string, userHome: string): string | null => {
  const recorded = recordedGitDir(home);
  if (recorded) {
    return recorded.replace(/^~(?=\/)/, userHome);
  }
  const link = join(home, '.git');
  if (lstat(link)?.isFile()) {
    return readFileSync(link, 'utf-8').match(/^gitdir:\s*(.+)$/m)?.[1]?.trim() ?? null;
  }
  return null;
};

const historyDirty = (home: string, gitDir: string | null): boolean => {
  if (!gitDir && !lstat(join(home, '.git'))?.isDirectory()) {
    return false;
  }
  const where = gitDir ? ['--git-dir', gitDir, '--work-tree', home] : ['-C', home];
  try {
    return execFileSync('git', ['--no-optional-locks', ...where, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  } catch {
    return false;
  }
};

const readJson = (path: string): JsonObject | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonObject) : null;
  } catch {
    return null;
  }
};

/** The checkout a home loads the old plugin from, when it registered one as a directory marketplace. */
const oldCheckoutOf = (settings: (JsonObject | null)[]): string | null =>
  settings
    .map((file) => {
      const market = file?.extraKnownMarketplaces;
      const entry = typeof market === 'object' && market !== null && !Array.isArray(market) ? market[SOURCE.devMarketplace] : undefined;
      const source = typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry.source : undefined;
      const path = typeof source === 'object' && source !== null && !Array.isArray(source) ? source.path : undefined;
      return typeof path === 'string' ? path : null;
    })
    .find((path): path is string => path !== null) ?? null;

/**
 * Transcripts Claude Code holds for the old home that capture should see. A session the index knows by
 * its full id goes to capture, whose cursor keeps only turns the brain lacks. One it knows only by the
 * short id older captures used, or one a day-log entry is headed by, was captured whole before cursors
 * existed, so capturing it again would write its turns twice; only a session found nowhere is new.
 */
const transcriptsOf = (home: string, claudeProjects: string): string[] => {
  const folder = join(claudeProjects, home.replace(/[^A-Za-z0-9-]/g, '-'));
  if (!existsSync(folder)) {
    return [];
  }
  const indexed = Object.keys((readJson(join(home, SESSIONS, 'index.json'))?.sessions as JsonObject | undefined) ?? {});
  const logged = new Set(
    filesUnder(home, SESSIONS, () => false).flatMap((rel) =>
      (textOf(join(home, rel)) ?? '').split(ENTRY_SPLIT_RE).flatMap((entry) => entry.match(ENTRY_ID)?.[1] ?? [])
    )
  );
  return readdirSync(folder)
    .filter((name) => name.endsWith('.jsonl'))
    .filter((name) => {
      const id = name.slice(0, -'.jsonl'.length);
      return indexed.includes(id) || (!indexed.includes(id.slice(0, 8)) && !logged.has(id.slice(0, 8)));
    })
    .map((name) => join(folder, name));
};

export const planMigration = (options: MigrateOptions): Plan => {
  const home = canonicalPath(options.home);
  const to = options.to;
  const blockers: string[] = [];
  const version = readJson(join(home, RUNTIME_DIR, 'version.json'));
  if (version?.plugin !== SOURCE.plugin) {
    blockers.push(`${home} is not an ${SOURCE.plugin} home (no ${RUNTIME_DIR}/version.json recording it)`);
  } else if (version.templateVersion !== options.pluginVersion) {
    blockers.push(
      `the home is on ${String(version.templateVersion)}; run /${SOURCE.plugin}:upgrade to ${options.pluginVersion} first`
    );
  }
  if (existsSync(to)) {
    blockers.push(`${to} already exists; migrate copies into a new folder`);
  }
  if (options.name !== undefined && !NAME_RE.test(options.name)) {
    blockers.push(`--name "${options.name}" must match ${NAME_RE} (letters, digits, spaces, hyphens)`);
  }
  if (options.avatar !== undefined && !lstat(options.avatar)?.isFile()) {
    blockers.push(`--avatar ${options.avatar} is not a file`);
  }
  if (options.welcome !== undefined && !lstat(options.welcome)?.isFile()) {
    blockers.push(`--welcome ${options.welcome} is not a file`);
  }

  const identity = existsSync(join(home, IDENTITY)) ? (textOf(join(home, IDENTITY)) ?? '') : '';
  const current = agentNameIn(identity);
  const rename = options.name && current && options.name !== current ? { from: current, to: options.name } : undefined;

  const settingsFiles = SETTINGS.map((rel) => ({ rel, json: readJson(join(home, rel)) }));
  const oldCheckout = oldCheckoutOf(settingsFiles.map(({ json }) => json)) ?? options.sourceCheckout ?? null;
  const newCheckout = options.checkout ?? (oldCheckout ? join(dirname(oldCheckout), TARGET.checkout) : null);
  if (oldCheckout && newCheckout && readJson(join(newCheckout, '.claude-plugin', 'plugin.json'))?.name !== TARGET.plugin) {
    blockers.push(`${newCheckout} is not a ${TARGET.plugin} checkout; pass --checkout <path>`);
  }
  Object.entries(options.roots)
    .filter(([name, root]) => canonicalPath(root) !== join(home, name))
    .forEach(([name, root]) => blockers.push(`this home keeps its ${name} in ${root}; migrate moves only ${join(home, name)}, so move it back first`));
  // A copy inside the folder it copies would recurse into itself.
  if (isInside(to, home)) {
    blockers.push(`${to} is inside the home it would copy; pick a folder outside it`);
  }
  const oldHistory = historyOf(home, options.userHome);
  const newHistory = oldHistory ? join(options.stateRoot, TARGET.stateFolder, `${historyName(to, options.userHome)}.git`) : null;
  if (newHistory && existsSync(newHistory)) {
    blockers.push(`${newHistory} already exists`);
  }
  if (historyDirty(home, oldHistory)) {
    blockers.push('the home has changes its history has not committed; run sync first');
  }

  const homeMove: PathMove = { from: home, to };
  const paths: PathMove[] = [
    homeMove,
    ...(oldCheckout && newCheckout ? [{ from: oldCheckout, to: newCheckout }] : []),
    ...(oldHistory && newHistory ? [{ from: oldHistory, to: newHistory }] : [])
  ];
  const context: RuleContext = { home: homeMove, paths, rename };
  const keepBy = (rel: string): Set<number> =>
    new Set(
      options.keep
        .filter((entry) => /:\d+$/.test(entry) && entry.slice(0, entry.lastIndexOf(':')) === posix(rel))
        .map((entry) => Number(entry.slice(entry.lastIndexOf(':') + 1)))
    );

  const edits: Edit[] = [];
  const report: Plan['report'] = {
    agent: { name: rename?.to ?? current, formerly: formerNamesIn(identity) },
    persona: [],
    product: [],
    other: {},
    review: [],
    leftovers: [],
    manual: []
  };
  const tally = (kind: string): void => {
    report.other[kind] = (report.other[kind] ?? 0) + 1;
  };

  const tasks = new Set(taskFiles(home));
  const markdown = curated(home);
  [...new Set([...markdown, ...tasks])].forEach((rel) => {
    const before = textOf(join(home, rel));
    if (before === null) {
      report.manual.push(`${posix(rel)}: not UTF-8, left as written`);
      return;
    }
    // A bare path keeps the whole file: a document about the old agent's past, or about the move itself.
    const inScope = markdown.includes(rel) && !options.keep.includes(posix(rel));
    // A task's thread is its dated log, kept as written like the other dated records.
    const thread = tasks.has(rel) ? before.search(THREAD) : -1;
    const head = thread === -1 ? before : before.slice(0, thread);
    const tail = thread === -1 ? '' : before.slice(thread);
    const mascot = inScope ? head.split('\n').flatMap((line, index) => (MASCOT.test(line) ? [index + 1] : [])) : [];
    report.manual.push(...mascot.map((line) => `${posix(rel)}:${line}: about the old mascot, kept as written for you to rewrite`));
    const keep = new Set([...keepBy(rel), ...mascot]);
    const plain = inScope ? migrateText(head, { ...context, rename: undefined }, options.userHome, keep) + tail : before;
    const renamed = inScope && rename ? migrateText(head, context, options.userHome, keep) + tail : plain;
    const after = tasks.has(rel) ? taskAssignee(renamed) : renamed;
    if (after === before) {
      return;
    }
    edits.push({ path: rel, text: after });
    const personaLines = new Set(lineChanges(rel, plain, renamed).map((change) => change.line));
    lineChanges(rel, before, after).forEach((change) => {
      if (personaLines.has(change.line)) {
        report.persona.push(change);
      } else if (/agentlayer(?![-\w@:_])/.test(change.after) && !/agentlayer(?![-\w@:_])/.test(change.before)) {
        report.product.push(change);
      } else {
        tally('paths, commands and tool names');
      }
    });
    if (!rename || rename.from !== 'Kevin') {
      report.review.push(
        ...after
          .split('\n')
          .flatMap((line, index) => (/(?<![\w/-])Kevin(?![\w/-])/.test(line) ? [{ path: posix(rel), line: index + 1, before: line.trim(), after: line.trim() }] : []))
      );
    }
  });

  const oldAvatar = identity.match(/^!\[[^\]]*\]\(([^)]+)\)/m)?.[1];
  if (rename || options.emoji || options.avatar) {
    const path = IDENTITY;
    const base = edits.find((edit) => edit.path === path)?.text ?? identity;
    const formerly = rename ? [...formerNamesIn(identity).filter((name) => name !== rename.from && name !== rename.to), rename.from] : [];
    const eol = base.includes('\r\n') ? '\r\n' : '\n';
    const withName = rename ? base.replace(NAME_FIELD, `$1 ${rename.to}`) : base;
    const withFormerly = !rename
      ? withName
      : FORMERLY_FIELD.test(withName)
        ? withName.replace(FORMERLY_FIELD, `- **Formerly:** ${formerly.join(', ')}`)
        : withName.replace(NAME_FIELD, `$&${eol}- **Formerly:** ${formerly.join(', ')}`);
    const withEmoji = options.emoji ? withFormerly.replace(/^(.*?\*\*Emoji:\*\*)[ \t]*.*$/m, `$1 ${options.emoji}`) : withFormerly;
    const avatarRel = options.avatar
      ? posix(join('assets', `${(rename?.to ?? current).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-avatar${extname(options.avatar)}`))
      : undefined;
    const withAvatar =
      avatarRel && oldAvatar
        ? withEmoji.replace(/^!\[[^\]]*\]\([^)]+\)/m, `![${rename?.to ?? current}](${avatarRel})`).replace(
            /^(.*?\*\*Avatar:\*\*)[ \t]*.*$/m,
            `$1 [\`${avatarRel}\`](${avatarRel})`
          )
        : withEmoji;
    const swept = edits.findIndex((edit) => edit.path === path);
    edits.splice(swept === -1 ? edits.length : swept, 1, { path, text: withAvatar });
    report.agent = { name: rename?.to ?? current, formerly: rename ? formerly : formerNamesIn(identity), emoji: options.emoji, avatar: avatarRel };
  }

  settingsFiles.forEach(({ rel, json }) => {
    if (!json) {
      return;
    }
    const migrated = migrateSettings(json, paths, options.userHome);
    if (JSON.stringify(migrated) !== JSON.stringify(json)) {
      edits.push({ path: rel, text: `${JSON.stringify(migrated, null, 2)}\n` });
      tally('settings files');
    }
    report.leftovers.push(...leftovers(migrated).map((entry) => `${posix(rel)} ${entry}`));
  });

  const codexConfig = existsSync(join(home, CODEX_CONFIG)) ? readFileSync(join(home, CODEX_CONFIG), 'utf-8') : null;
  if (codexConfig !== null) {
    const after = migrateCodexConfig(codexConfig, paths, options.userHome);
    const parses = ((): boolean => {
      try {
        Bun.TOML.parse(after);
        return true;
      } catch {
        return false;
      }
    })();
    if (!parses) {
      report.manual.push(`${posix(CODEX_CONFIG)}: remove the [mcp_servers.${SOURCE.server}] and [permissions.${SOURCE.server}] tables by hand`);
    } else if (after !== codexConfig) {
      edits.push({ path: CODEX_CONFIG, text: after });
      tally('Codex files');
    }
  }
  const codexHooks = readJson(join(home, CODEX_HOOKS));
  if (codexHooks) {
    const after = migrateCodexHooks(codexHooks);
    if (JSON.stringify(after) !== JSON.stringify(codexHooks)) {
      edits.push({ path: CODEX_HOOKS, text: `${JSON.stringify(after, null, 2)}\n` });
      tally('Codex files');
    }
  }
  const deletes = [
    ...(existsSync(join(home, CODEX_RULES)) ? [CODEX_RULES] : []),
    ...(report.agent.avatar && oldAvatar && oldAvatar !== report.agent.avatar && isInside(join(home, oldAvatar), home) && existsSync(join(home, oldAvatar))
      ? [oldAvatar]
      : [])
  ];

  filesUnder(home, TEMPLATE_BASE, () => false).forEach((rel) => {
    const before = textOf(join(home, rel));
    const after = before === null ? null : before.split('\n').map(productText).join('\n');
    if (before !== null && after !== null && after !== before) {
      edits.push({ path: rel, text: after });
      tally('template baseline files');
    }
  });

  // A note already inside the home moves with it; one from elsewhere (another home's move) is copied in.
  const welcomeFrom = options.welcome === undefined ? undefined : canonicalPath(options.welcome);
  const noteInside = welcomeFrom !== undefined && isInside(welcomeFrom, home);
  const note = welcomeFrom === undefined ? undefined : noteInside ? relative(home, welcomeFrom) : join('reports', 'plans', basename(welcomeFrom));
  if (version) {
    const migratedFrom = { plugin: SOURCE.plugin, home, name: current, at: todayDate(), ...(note ? { note: posix(note) } : {}) };
    edits.push({
      path: join(RUNTIME_DIR, 'version.json'),
      text: `${JSON.stringify({ ...version, plugin: TARGET.plugin, migratedFrom }, null, 2)}\n`
    });
  }
  // The new plugin's first session in the copy greets it as a moved home.
  edits.push({
    path: CADENCE,
    text: `${JSON.stringify({ ...(readJson(join(home, CADENCE)) ?? {}), welcome: 'pending' }, null, 2)}\n`
  });

  MANUAL_TREES.forEach((tree) =>
    filesUnder(home, tree, () => false, false).forEach((rel) => {
      const text = textOf(join(home, rel)) ?? '';
      text.split('\n').forEach((line, index) => {
        if (/agent-kevin|bin\/kevin|mcp__plugin_agent-kevin/.test(line)) {
          report.manual.push(`${posix(rel)}:${index + 1}: ${line.trim()}`);
        }
      });
    })
  );

  const written = [
    ...edits.map((edit) => edit.path),
    ...deletes,
    ...(report.agent.avatar ? [report.agent.avatar] : []),
    ...(note && !noteInside ? [note] : []),
    SESSIONS
  ];
  const linked = written.filter((rel) =>
    rel.split(sep).some((_, index, parts) => lstat(join(home, ...parts.slice(0, index + 1)))?.isSymbolicLink())
  );
  if (linked.length > 0) {
    blockers.push(`migrate won't write through a symlink in the copy: ${linked.map(posix).join(', ')}`);
  }

  return {
    from: home,
    to,
    blockers,
    edits,
    deletes,
    copies: [
      ...(options.avatar && report.agent.avatar ? [{ from: options.avatar, to: report.agent.avatar }] : []),
      ...(welcomeFrom && note && !noteInside ? [{ from: welcomeFrom, to: note }] : [])
    ],
    history: oldHistory && newHistory ? { from: oldHistory, to: newHistory } : null,
    transcripts: transcriptsOf(home, options.claudeProjects),
    report
  };
};
