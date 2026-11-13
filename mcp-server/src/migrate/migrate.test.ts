import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyMigration } from './apply';
import { type MigrateOptions, planMigration } from './plan';

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

/** A home the old plugin set up, with its history kept outside it, as sync's history feature does. */
const fixture = () => {
  const user = realpathSync(mkdtempSync(join(tmpdir(), 'migrate-')));
  roots.push(user);
  const home = join(user, 'Agents', 'Kevin');
  const state = join(user, '.local', 'state');
  const gitDir = join(state, 'agent-kevin', 'Agents-Kevin.git');
  const oldCheckout = join(user, 'code', 'agent-kevin');
  const newCheckout = join(user, 'code', 'agentlayer-agent');
  write(join(newCheckout, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'agentlayer' }));
  const files: Record<string, string> = {
    '.state/version.json': JSON.stringify({ plugin: 'agent-kevin', templateVersion: '9.9.9' }),
    'IDENTITY.md': '# Identity\n\n![Kevin](assets/kevin-avatar.jpg)\n\n- **Name:** Kevin\n- **Emoji:** 🍌\n- **Avatar:** [`assets/kevin-avatar.jpg`](assets/kevin-avatar.jpg)\n',
    'assets/kevin-avatar.jpg': 'old',
    'AGENTS.md': `# Manual\n\nKevin runs /agent-kevin:sync. History: \`${gitDir}\`.\nKevin Moreau has a channel.\n`,
    'knowledge/concepts/plugin.md': `Shipped in Kevin v0.5.0; see ~/Agents/Kevin/reports/plans/x.md and ${oldCheckout}/README.md.\n`,
    'knowledge/memory/2026-11-11.md': 'Kevin shipped /agent-kevin:sync today.\n',
    'knowledge/raw/sessions/2026-11-11.md': 'Kevin said hi.\n',
    'reports/briefings/x.md': 'Kevin briefed.\n',
    'projects/p/tasks/p-001-live.md': '---\nid: p-001\nassignee: [kevin]\n---\nKevin builds it.\n\n## Thread\n\n> [!info] Kevin · 2026-11-02\n> Ran /agent-kevin:sync.\n',
    'projects/p/tasks/archive/p-000-old.md': '---\nid: p-000\nassignee:\n  - kevin\n---\nKevin built it.\n',
    '.claude/settings.local.json': JSON.stringify({
      enabledPlugins: { 'agent-kevin@agentdev-kevin': true },
      extraKnownMarketplaces: { 'agentdev-kevin': { source: { source: 'directory', path: oldCheckout } } },
      statusLine: { type: 'command', command: `bun "${oldCheckout}/bin/kevin" statusline` },
      env: { AGENT_HOME_GIT_DIR: gitDir, SUPPORTCANDY_USERNAME_ACME: 'agent-kevin' },
      permissions: { allow: ['mcp__plugin_agent-kevin_kevin__task_query', 'Bash(kevin slack *)'], additionalDirectories: [gitDir] }
    }),
    '.codex/config.toml': `default_permissions = "kevin"\n\n[mcp_servers.kevin]\ncommand = "bun"\n`,
    '.codex/rules/kevin.rules': '# generated\n',
    '.state/template-base/AGENTS.md': 'Run /agent-kevin:upgrade.\n',
    '.gitignore': '.state/secrets/\n'
  };
  Object.entries(files).forEach(([rel, text]) => write(join(home, rel), text));
  mkdirSync(dirname(gitDir), { recursive: true });
  execFileSync('git', ['init', '-q', `--separate-git-dir=${gitDir}`, home]);
  const run = (...args: string[]) => execFileSync('git', ['--git-dir', gitDir, '--work-tree', home, ...args]);
  run('config', 'user.name', 'Ada');
  run('config', 'user.email', 'ada@acme.example');
  run('config', 'agent.home', home);
  run('add', '-A');
  run('commit', '-q', '-m', 'Sync: the home');
  const options: MigrateOptions = {
    home,
    to: join(user, 'Agents', 'Oppi'),
    name: 'Oppi',
    emoji: '🐙',
    keep: ['AGENTS.md:4'],
    userHome: user,
    pluginVersion: '9.9.9',
    roots: { knowledge: join(home, 'knowledge'), projects: join(home, 'projects'), reports: join(home, 'reports') },
    claudeProjects: join(user, '.claude', 'projects'),
    stateRoot: state
  };
  return { user, home, gitDir, newCheckout, options, files };
};

const snapshot = (home: string, files: Record<string, string>): string[] =>
  Object.keys(files).map((rel) => readFileSync(join(home, rel), 'utf-8'));

describe('migrate', () => {
  test('the plan writes nothing and lists the changes by kind', () => {
    const { home, options, files } = fixture();
    const before = snapshot(home, files);
    const plan = planMigration(options);
    expect(plan.blockers).toEqual([]);
    expect(snapshot(home, files)).toEqual(before);
    expect(existsSync(options.to)).toBe(false);
    expect(plan.report.persona.map((change) => `${change.path}:${change.line}`)).toEqual([
      'IDENTITY.md:3',
      'IDENTITY.md:5',
      'AGENTS.md:3',
      'projects/p/tasks/p-001-live.md:5'
    ]);
    expect(plan.report.product.map((change) => `${change.path}:${change.line}`)).toEqual(['knowledge/concepts/plugin.md:1']);
    expect(plan.report.leftovers).toEqual(['.claude/settings.local.json env.SUPPORTCANDY_USERNAME_ACME: agent-kevin']);
  });

  test('apply copies, renames, rewires and commits, leaving the old home and dated records as written', async () => {
    const { home, gitDir, newCheckout, options, files } = fixture();
    const before = snapshot(home, files);
    const plan = planMigration(options);
    const result = await applyMigration(plan, false);
    const to = options.to;
    const read = (rel: string) => readFileSync(join(to, rel), 'utf-8');

    expect(snapshot(home, files)).toEqual(before);
    expect(read('IDENTITY.md')).toBe(
      '# Identity\n\n![Oppi](assets/kevin-avatar.jpg)\n\n- **Name:** Oppi\n- **Formerly:** Kevin\n- **Emoji:** 🐙\n- **Avatar:** [`assets/kevin-avatar.jpg`](assets/kevin-avatar.jpg)\n'
    );
    expect(read('AGENTS.md')).toBe(
      `# Manual\n\nOppi runs /agentlayer:sync. History: \`${result.history}\`.\nKevin Moreau has a channel.\n`
    );
    expect(read('knowledge/concepts/plugin.md')).toBe(
      `Shipped in agentlayer v0.5.0; see reports/plans/x.md and ${newCheckout}/README.md.\n`
    );
    ['knowledge/memory/2026-11-11.md', 'knowledge/raw/sessions/2026-11-11.md', 'reports/briefings/x.md'].forEach((rel) =>
      expect(read(rel)).toBe(files[rel] ?? '')
    );
    expect(read('projects/p/tasks/p-001-live.md')).toBe(
      '---\nid: p-001\nassignee: [agent]\n---\nOppi builds it.\n\n## Thread\n\n> [!info] Kevin · 2026-11-02\n> Ran /agent-kevin:sync.\n'
    );
    expect(read('projects/p/tasks/archive/p-000-old.md')).toBe('---\nid: p-000\nassignee:\n  - agent\n---\nKevin built it.\n');

    const settings = JSON.parse(read('.claude/settings.local.json'));
    expect(settings.enabledPlugins).toEqual({ 'agentlayer@agentlayer-dev': true });
    expect(settings.extraKnownMarketplaces['agentlayer-dev'].source.path).toBe(newCheckout);
    expect(settings.statusLine).toBeUndefined();
    expect(settings.env).toEqual({ AGENT_HOME_GIT_DIR: result.history, SUPPORTCANDY_USERNAME_ACME: 'agent-kevin' });
    expect(settings.permissions).toEqual({ allow: ['mcp__plugin_agentlayer_agent__task_query'], additionalDirectories: [result.history] });
    expect(read('.codex/config.toml')).toBe('');
    expect(existsSync(join(to, '.codex/rules/kevin.rules'))).toBe(false);
    expect(read('.state/template-base/AGENTS.md')).toBe('Run /agentlayer:upgrade.\n');
    expect(JSON.parse(read('.state/version.json'))).toEqual({
      plugin: 'agentlayer',
      templateVersion: '9.9.9',
      migratedFrom: { plugin: 'agent-kevin', home }
    });

    expect(result.history).toBe(join(options.stateRoot, 'agentlayer', 'Agents-Oppi.git'));
    const log = (dir: string, ...args: string[]) => execFileSync('git', ['--git-dir', dir, ...args], { encoding: 'utf8' }).trim();
    expect(log(result.history ?? '', 'log', '--format=%s')).toBe('Moved from agent-kevin\nSync: the home');
    expect(log(result.history ?? '', 'config', 'core.worktree')).toBe(to);
    expect(log(result.history ?? '', 'config', 'agent.home')).toBe(to);
    expect(log(gitDir, 'log', '--format=%s')).toBe('Sync: the home');
    expect(execFileSync('git', ['-C', to, 'status', '--porcelain'], { encoding: 'utf8' })).toBe('');
    expect(result.retired).toBe(false);
  });

  test('a final run stamps the old home as moved, and nothing else there changes', async () => {
    const { home, options } = fixture();
    await applyMigration(planMigration(options), true);
    expect(JSON.parse(readFileSync(join(home, '.state/version.json'), 'utf-8'))).toEqual({
      plugin: 'agent-kevin',
      templateVersion: '9.9.9',
      movedTo: options.to
    });
  });

  test('a new avatar replaces the old one in the copy', async () => {
    const { user, options } = fixture();
    const image = join(user, 'oppi.png');
    writeFileSync(image, 'new');
    await applyMigration(planMigration({ ...options, avatar: image }), false);
    const identity = readFileSync(join(options.to, 'IDENTITY.md'), 'utf-8');
    expect(identity).toContain('![Oppi](assets/oppi-avatar.png)');
    expect(identity).toContain('- **Avatar:** [`assets/oppi-avatar.png`](assets/oppi-avatar.png)');
    expect(readFileSync(join(options.to, 'assets/oppi-avatar.png'), 'utf-8')).toBe('new');
    expect(existsSync(join(options.to, 'assets/kevin-avatar.jpg'))).toBe(false);
  });

  test('blocks a home on another version, a taken folder, uncommitted changes and a bad name', () => {
    const { home, options } = fixture();
    writeFileSync(join(home, 'scratch.md'), 'not yet synced\n');
    mkdirSync(options.to, { recursive: true });
    const blockers = planMigration({ ...options, pluginVersion: '9.9.10', name: 'Op/pi' }).blockers.join('\n');
    expect(blockers).toContain('run /agent-kevin:upgrade to 9.9.10 first');
    expect(blockers).toContain('already exists');
    expect(blockers).toContain('run sync first');
    expect(blockers).toContain('--name "Op/pi"');
  });

  test('a session Claude Code holds that the brain lacks is listed for capture', () => {
    const { home, options } = fixture();
    const folder = join(options.claudeProjects, home.replace(/[^A-Za-z0-9-]/g, '-'));
    write(join(folder, 'abc.jsonl'), '{}\n');
    expect(planMigration(options).transcripts).toEqual([join(folder, 'abc.jsonl')]);
  });
});

describe('migrate capture', () => {
  test('capture sees a session the index knows by full id, or one found nowhere, never one captured before cursors', () => {
    const { home, options } = fixture();
    const folder = join(options.claudeProjects, home.replace(/[^A-Za-z0-9-]/g, '-'));
    const sessions = join(home, 'knowledge', 'raw', 'sessions');
    write(join(sessions, 'index.json'), JSON.stringify({ sessions: { 'aaaa1111-known': {}, bbbb2222: {} } }));
    write(join(sessions, '2026-05-20.md'), '### Session (16:00) [cccc3333] · ~/Agents/Kevin\n\n**User:** hi\n');
    ['aaaa1111-known', 'bbbb2222-short', 'cccc3333-logged', 'dddd4444-new'].forEach((id) => write(join(folder, `${id}.jsonl`), '{}\n'));
    write(join(folder, 'notes.txt'), 'not a transcript\n');
    expect(planMigration(options).transcripts.sort()).toEqual(
      ['aaaa1111-known', 'dddd4444-new'].map((id) => join(folder, `${id}.jsonl`))
    );
  });
});

describe('migrate without a marketplace entry', () => {
  test('a home that names the checkout only in its grants gets the new checkout there too', () => {
    const { home, options, newCheckout } = fixture();
    const oldCheckout = join(dirname(newCheckout), 'agent-kevin');
    write(join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { additionalDirectories: [oldCheckout] } }));
    execFileSync('git', ['-C', home, 'add', '-A']);
    execFileSync('git', ['-C', home, 'commit', '-q', '-m', 'grant']);
    const plan = planMigration({ ...options, sourceCheckout: oldCheckout });
    const shared = plan.edits.find((edit) => edit.path === join('.claude', 'settings.json'));
    expect(JSON.parse(shared?.text ?? '{}').permissions.additionalDirectories).toEqual([newCheckout]);
  });
});

describe('migrate that stops partway', () => {
  test('names what it left behind, and the old home is unchanged', async () => {
    const { home, options, files } = fixture();
    const before = snapshot(home, files);
    write(join(options.stateRoot, 'agentlayer'), 'a file where the history folder goes');
    const plan = planMigration(options);
    expect(plan.blockers).toEqual([]);
    const stopped = await applyMigration(plan, true).catch((error: Error) => error.message);
    expect(stopped).toBe(`The migration stopped partway and ${home} is unchanged; delete ${options.to} and run it again.`);
    expect(snapshot(home, files)).toEqual(before);
  });
});

describe('migrate keeps to the home it copies', () => {
  test('a dry run leaves the old history index byte for byte', () => {
    const { home, gitDir, options } = fixture();
    const index = readFileSync(join(gitDir, 'index'));
    utimesSync(join(home, 'IDENTITY.md'), new Date(), new Date('2030-01-01'));
    planMigration(options);
    expect(readFileSync(join(gitDir, 'index')).equals(index)).toBe(true);
  });

  test('a home whose knowledge resolves outside its folder is refused, and one inside it is not', () => {
    const { home, options } = fixture();
    expect(planMigration({ ...options, roots: { ...options.roots, knowledge: '/elsewhere/knowledge' } }).blockers.join('\n')).toContain(
      "this home's knowledge lives outside it (/elsewhere/knowledge)"
    );
    expect(planMigration({ ...options, roots: { ...options.roots, knowledge: join(home, 'knowledge') } }).blockers).toEqual([]);
  });

  test('a new folder inside the old home is refused before anything is written', () => {
    const { home, options } = fixture();
    expect(planMigration({ ...options, to: join(home, 'new', 'Oppi') }).blockers.join('\n')).toContain('is inside the home it would copy');
    expect(existsSync(join(home, 'new'))).toBe(false);
  });

  test('a session id quoted in conversation text is not mistaken for its capture', () => {
    const { home, options } = fixture();
    const folder = join(options.claudeProjects, home.replace(/[^A-Za-z0-9-]/g, '-'));
    write(join(home, 'knowledge', 'raw', 'sessions', '2026-11-12.md'), '### Session (10:00) [eeee5555] · ~/Agents/Kevin\n\n**User:** resume [ffff6666 please\n');
    write(join(folder, 'ffff6666-quoted.jsonl'), '{}\n');
    expect(planMigration(options).transcripts).toEqual([join(folder, 'ffff6666-quoted.jsonl')]);
  });

  test('a planned write through a symlink is refused', () => {
    const { home, user, options } = fixture();
    const shared = join(user, 'shared-settings.json');
    write(shared, JSON.stringify({ permissions: { allow: ['Skill(agent-kevin:sync)'] } }));
    symlinkSync(shared, join(home, '.claude', 'settings.json'));
    expect(planMigration(options).blockers.join('\n')).toContain("won't write through a symlink in the copy: .claude/settings.json");
  });

  test('a replaced avatar outside the home is never deleted', () => {
    const { home, user, options } = fixture();
    write(join(user, 'Agents', 'shared.jpg'), 'shared');
    write(join(home, 'IDENTITY.md'), '- **Name:** Kevin\n![Kevin](../shared.jpg)\n- **Avatar:** [`../shared.jpg`](../shared.jpg)\n');
    const image = join(user, 'oppi.png');
    write(image, 'new');
    expect(planMigration({ ...options, avatar: image }).deletes).not.toContain('../shared.jpg');
  });

  test('a home with no history of its own never commits into a repository around it', async () => {
    const outer = realpathSync(mkdtempSync(join(tmpdir(), 'migrate-outer-')));
    roots.push(outer);
    execFileSync('git', ['init', '-q', outer]);
    execFileSync('git', ['-C', outer, 'commit', '-q', '--allow-empty', '-m', 'outer'], {
      env: { ...process.env, GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'a@acme.example', GIT_COMMITTER_NAME: 'Ada', GIT_COMMITTER_EMAIL: 'a@acme.example' }
    });
    const home = join(outer, 'Agents', 'Kevin');
    write(join(home, '.state', 'version.json'), JSON.stringify({ plugin: 'agent-kevin', templateVersion: '9.9.9' }));
    write(join(home, 'AGENTS.md'), 'Run /agent-kevin:sync.\n');
    const result = await applyMigration(
      planMigration({ ...fixture().options, home, to: join(outer, 'Agents', 'Oppi'), checkout: undefined, roots: { knowledge: join(home, 'knowledge'), projects: join(home, 'projects'), reports: join(home, 'reports') } }),
      false
    );
    expect(result.commits).toEqual([]);
    expect(execFileSync('git', ['-C', outer, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('1');
  });
});
