import { describe, expect, test } from 'bun:test';
import type { PathMove } from './rules';
import { leftovers, migrateCodexConfig, migrateCodexHooks, migrateSettings } from './settings';

const USER = '/Users/ada';
const moves: PathMove[] = [
  { from: '/Users/ada/Agents/Kevin', to: '/Users/ada/Agents/Oppi' },
  { from: '/Users/ada/code/agent-kevin', to: '/Users/ada/code/agentlayer-agent' },
  { from: '/Users/ada/.local/state/agent-kevin/Agents-Kevin.git', to: '/Users/ada/.local/state/agentlayer/Agents-Oppi.git' }
];

describe('migrateSettings', () => {
  const local = migrateSettings(
    {
      permissions: {
        allow: [
          'mcp__plugin_agent-kevin_kevin__task_query',
          'Skill(agent-kevin:sync)',
          'Bash(kevin slack *)',
          'Bash(git status *)',
          'mcp__plugin_agentlayer_agent__task_query'
        ],
        additionalDirectories: ['/Users/ada/.local/state/agent-kevin/Agents-Kevin.git', '/Users/ada/code']
      },
      enabledPlugins: { 'agent-kevin@agentdev-kevin': true, 'swift-lsp@claude-plugins-official': true },
      extraKnownMarketplaces: { 'agentdev-kevin': { source: { source: 'directory', path: '/Users/ada/code/agent-kevin' } } },
      statusLine: { type: 'command', command: 'bun "/Users/ada/code/agent-kevin/bin/kevin" statusline' },
      env: {
        AGENT_HOME_GIT_DIR: '/Users/ada/.local/state/agent-kevin/Agents-Kevin.git',
        AGENT_GIT_REPOS: '/Users/ada/code/agent-kevin,/Users/ada/code/site',
        SUPPORTCANDY_USERNAME_ACME: 'agent-kevin'
      },
      sandbox: { filesystem: { allowWrite: ['~/.local/state/agent-kevin/Agents-Kevin.git'] } }
    },
    moves,
    USER
  );

  test('grants take the new names, deduplicated, and the PATH-only CLI grant goes', () => {
    expect(local.permissions).toMatchObject({
      allow: ['mcp__plugin_agentlayer_agent__task_query', 'Skill(agentlayer:sync)', 'Bash(git status *)'],
      additionalDirectories: ['/Users/ada/.local/state/agentlayer/Agents-Oppi.git', '/Users/ada/code']
    });
  });

  test('the plugin and its dev marketplace are renamed, and the marketplace points at the new checkout', () => {
    expect(local.enabledPlugins).toEqual({ 'agentlayer@agentlayer-dev': true, 'swift-lsp@claude-plugins-official': true });
    expect(local.extraKnownMarketplaces).toEqual({
      'agentlayer-dev': { source: { source: 'directory', path: '/Users/ada/code/agentlayer-agent' } }
    });
  });

  test("the old status line goes, paths move, and an unrelated value is kept as written", () => {
    expect(local.statusLine).toBeUndefined();
    expect(local.env).toEqual({
      AGENT_HOME_GIT_DIR: '/Users/ada/.local/state/agentlayer/Agents-Oppi.git',
      AGENT_GIT_REPOS: '/Users/ada/code/agentlayer-agent,/Users/ada/code/site',
      SUPPORTCANDY_USERNAME_ACME: 'agent-kevin'
    });
    expect(local.sandbox).toEqual({ filesystem: { allowWrite: ['~/.local/state/agentlayer/Agents-Oppi.git'] } });
  });

  test("an operator's own status line stays", () => {
    const own = { type: 'command', command: '~/.claude/statusline.sh' };
    expect(migrateSettings({ statusLine: own }, moves, USER).statusLine).toEqual(own);
  });

  test('leftovers names what still reads as the old plugin', () => {
    expect(leftovers(local)).toEqual(['env.SUPPORTCANDY_USERNAME_ACME: agent-kevin']);
  });
});

describe('migrateCodexConfig', () => {
  test("drops the old plugin's tables and default profile, keeps the operator's, moves paths", () => {
    const toml = [
      'default_permissions = "kevin"',
      'model = "gpt-5"',
      '',
      '[mcp_servers.kevin]',
      'command = "bun"',
      'args = ["/Users/ada/code/agent-kevin/mcp-server/src/server.ts"]',
      '',
      '[mcp_servers.kevin.env]',
      'AGENT_HOME = "/Users/ada/Agents/Kevin"',
      '',
      '[permissions.kevin.filesystem]',
      '"/Users/ada/Agents/Kevin" = "write"',
      '',
      '[mcp_servers.xcode]',
      'command = "xcrun"',
      'cwd = "/Users/ada/Agents/Kevin"',
      ''
    ].join('\n');
    expect(migrateCodexConfig(toml, moves, USER, [])).toBe(
      ['model = "gpt-5"', '', '[mcp_servers.xcode]', 'command = "xcrun"', 'cwd = "/Users/ada/Agents/Oppi"', ''].join('\n')
    );
  });

  test('switches off the old plugin Codex enables for every folder, unless the home already sets it', () => {
    const toml = '[plugins."agent-other@x"]\nenabled = false\n';
    expect(migrateCodexConfig(toml, moves, USER, ['agent-kevin@agentdev-kevin'])).toBe(
      '[plugins."agent-other@x"]\nenabled = false\n\n[plugins."agent-kevin@agentdev-kevin"]\nenabled = false\n'
    );
    const own = '[plugins."agent-kevin@agentdev-kevin"]\nenabled = true\n';
    expect(migrateCodexConfig(own, moves, USER, ['agent-kevin@agentdev-kevin'])).toBe(own);
  });
});

describe('migrateCodexHooks', () => {
  test("drops the old plugin's hooks and empty events, keeps the operator's", () => {
    const old = { type: 'command', command: 'bun "/Users/ada/code/agent-kevin/bin/kevin" guard --hook-protocol=codex' };
    const own = { type: 'command', command: '~/bin/notify.sh' };
    expect(
      migrateCodexHooks({
        hooks: {
          SessionStart: [{ matcher: '', hooks: [old] }],
          PreToolUse: [{ matcher: 'Bash', hooks: [old, own] }]
        }
      })
    ).toEqual({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [own] }] } });
  });
});

describe('the old plugin, and only it', () => {
  test("an operator's command that merely starts with the CLI's name is kept", () => {
    const own = { type: 'command', command: 'bun "/Users/ada/bin/kevin-custom" statusline' };
    expect(migrateSettings({ statusLine: own }, moves, USER).statusLine).toEqual(own);
  });

  test('an old table header with a trailing comment is still removed', () => {
    expect(migrateCodexConfig('[mcp_servers.kevin] # generated\ncommand = "bun"\n\n[tui]\nx = 1\n', moves, USER, [])).toBe('[tui]\nx = 1\n');
  });
});
