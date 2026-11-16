import { describe, expect, test } from 'bun:test';
import { type RuleContext, homeRelative, migrateText, movePaths, namesPlugin, productText, taskAssignee } from './rules';

const USER = '/Users/ada';
const HOME = { from: '/Users/ada/Agents/Kevin', to: '/Users/ada/Agents/Oppi' };
const context: RuleContext = {
  home: HOME,
  paths: [
    HOME,
    { from: '/Users/ada/code/agent-kevin', to: '/Users/ada/code/agentlayer-agent' },
    { from: '/Users/ada/.local/state/agent-kevin/Agents-Kevin.git', to: '/Users/ada/.local/state/agentlayer/Agents-Oppi.git' }
  ],
  rename: { from: 'Kevin', to: 'Oppi' }
};
const migrate = (text: string, keep: number[] = []) => migrateText(text, context, USER, new Set(keep));

describe('namesPlugin', () => {
  test('reads past the mechanical forms and catches a login, an address, a checkout path or prose', () => {
    for (const mechanical of ['run /agentlayer:sync', '"agentlayer@agentlayer-dev": true', 'mcp__plugin_agentlayer_agent__task_query']) {
      expect(namesPlugin(mechanical)).toBe(false);
    }
    for (const readable of ['ping agentlayer@acme.example', '~/Developer/AgentLayer/agentlayer-agent/src/x.ts', 'the agentlayer plugin', 'agentlayer_bot posted']) {
      expect(namesPlugin(readable)).toBe(true);
    }
  });
});

describe('productText', () => {
  test('tool ids, commands, grants and marketplaces take the new plugin and server names', () => {
    expect(productText('mcp__plugin_agent-kevin_kevin__task_query')).toBe('mcp__plugin_agentlayer_agent__task_query');
    expect(productText('run /agent-kevin:sync, then Skill(agent-kevin:engineer)')).toBe(
      'run /agentlayer:sync, then Skill(agentlayer:engineer)'
    );
    expect(productText('"agent-kevin@agentdev-kevin": true, agent-kevin@agentlayer')).toBe(
      '"agentlayer@agentlayer-dev": true, agentlayer@agentlayer'
    );
    expect(productText('https://github.com/AgentLayer1/agent-kevin/pull/3')).toBe(
      'https://github.com/AgentLayer1/agentlayer-agent/pull/3'
    );
    expect(productText('`bin/kevin task query`')).toBe('`src/cli.ts task query`');
  });

  test('Kevin as the plugin becomes agentlayer: a version and a commit', () => {
    expect(productText('shipped in Kevin v0.5.0 and Kevin 0.9.4')).toBe('shipped in agentlayer v0.5.0 and agentlayer 0.9.4');
    expect(productText('fixed in Kevin `79ef717`')).toBe('fixed in agentlayer `79ef717`');
    expect(productText('Kevin verifies the claim')).toBe('Kevin verifies the claim');
  });

  test('a name inside a file name, another repo or a login stays', () => {
    const text = '[[ab-045-windows-support-for-agent-kevin-native]] [[concepts/agent-kevin-notes]] acme/kevin-claw kevin-avatar.jpg ab-040-bin-kevin-session';
    expect(productText(text)).toBe(text);
  });
});

describe('movePaths', () => {
  test('moves every spelling, longest path first, and never cuts a longer name', () => {
    expect(movePaths('/Users/ada/code/agent-kevin, ~/code/agent-kevin/src', context.paths, USER)).toBe(
      '/Users/ada/code/agentlayer-agent, ~/code/agentlayer-agent/src'
    );
    expect(movePaths('~/.local/state/agent-kevin/Agents-Kevin.git', context.paths, USER)).toBe(
      '~/.local/state/agentlayer/Agents-Oppi.git'
    );
    expect(movePaths('/Users/ada/Agents/Kevinism', context.paths, USER)).toBe('/Users/ada/Agents/Kevinism');
  });

  test('a shell spelling of the home keeps its spelling', () => {
    expect(movePaths('d="$HOME/Agents/Kevin"; f="${HOME}/Agents/Kevin/.state"', context.paths, USER)).toBe(
      'd="$HOME/Agents/Oppi"; f="${HOME}/Agents/Oppi/.state"'
    );
  });
});

describe('homeRelative', () => {
  test('a path into the home becomes the path inside it; a link target and the bare folder stay', () => {
    expect(homeRelative('see `~/Agents/Kevin/reports/x.md`', HOME.from, USER)).toBe('see `reports/x.md`');
    expect(homeRelative('[x](/Users/ada/Agents/Kevin/reports/x.md)', HOME.from, USER)).toBe(
      '[x](/Users/ada/Agents/Kevin/reports/x.md)'
    );
    expect(homeRelative('scoped to ~/Agents/Kevin*', HOME.from, USER)).toBe('scoped to ~/Agents/Kevin*');
  });
});

describe('migrateText', () => {
  test('outside a fence: paths relative or moved, product names mapped, the agent renamed', () => {
    expect(migrate('Kevin keeps `~/Agents/Kevin/knowledge/index.md`; Kevin v0.9.4 ships /agent-kevin:sync')).toBe(
      'Oppi keeps `knowledge/index.md`; agentlayer v0.9.4 ships /agentlayer:sync'
    );
    expect(migrate('*scoped to ~/Agents/Kevin + code tree*')).toBe('*scoped to ~/Agents/Oppi + code tree*');
    expect(migrate('[report](/Users/ada/Agents/Kevin/reports/x.md)')).toBe('[report](/Users/ada/Agents/Oppi/reports/x.md)');
  });

  test('inside a fence a command keeps its absolute path, pointed at the new home', () => {
    const text = ['```bash', 'cd /Users/ada/Agents/Kevin && git log', '```', 'cd ~/Agents/Kevin/reports'].join('\n');
    expect(migrate(text)).toBe(['```bash', 'cd /Users/ada/Agents/Oppi && git log', '```', 'cd reports'].join('\n'));
  });

  test('a kept line is left exactly as written', () => {
    expect(migrate('Kevin Moreau on YouTube\nAsk Kevin', [1])).toBe('Kevin Moreau on YouTube\nAsk Oppi');
  });

  test('with no rename, only product names and paths change', () => {
    const plain = { ...context, rename: undefined };
    expect(migrateText('Kevin runs /agent-kevin:sync', plain, USER, new Set())).toBe('Kevin runs /agentlayer:sync');
  });
});

describe('taskAssignee', () => {
  test("the old server key in a task's assignee becomes the new one, in either list form", () => {
    expect(taskAssignee('---\nid: lo-1\nassignee: [user, kevin]\n---\nkevin did it\n')).toBe(
      '---\nid: lo-1\nassignee: [user, agent]\n---\nkevin did it\n'
    );
    expect(taskAssignee('---\nassignee:\n  - kevin\n  - user\nlabels: []\n---\n')).toBe(
      '---\nassignee:\n  - agent\n  - user\nlabels: []\n---\n'
    );
  });

  test('a file with no frontmatter or no such assignee is unchanged', () => {
    expect(taskAssignee('# notes about kevin\n')).toBe('# notes about kevin\n');
    expect(taskAssignee('---\nassignee: [user]\n---\n')).toBe('---\nassignee: [user]\n---\n');
  });
});
