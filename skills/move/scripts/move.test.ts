import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listHomes } from './homes';
import { keepCandidates } from './keep-candidates';

const root = mkdtempSync(join(tmpdir(), 'move-skill-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

describe('listHomes', () => {
  const claudeDir = join(root, '.claude');
  const home = (name: string, version: Record<string, string>, agent: string): string => {
    const path = join(root, 'Agents', name);
    write(join(path, '.state', 'version.json'), JSON.stringify(version));
    write(join(path, 'IDENTITY.md'), `# Identity\n\n- **Name:** ${agent}\n`);
    return path;
  };
  const kevin = home('Kevin', { plugin: 'agent-kevin', templateVersion: '0.9.5' }, 'Kevin');
  const scout = home('Scout', { plugin: 'agent-kevin', templateVersion: '0.9.3' }, 'Scout');
  const moved = home('Old', { plugin: 'agent-kevin', templateVersion: '0.9.5', movedTo: '/elsewhere/Oppi' }, 'Old');
  const other = home('Other', { plugin: 'agent-other', templateVersion: '1.0.0' }, 'Other');
  write(
    join(claudeDir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'agent-kevin@agentdev-kevin': [
          { scope: 'project', projectPath: kevin },
          { scope: 'local', projectPath: kevin },
          { scope: 'project', projectPath: scout },
          { scope: 'user' }
        ],
        'agent-kevin@agentlayer': [{ scope: 'project', projectPath: moved }],
        'agent-other@elsewhere': [{ scope: 'project', projectPath: other }]
      }
    })
  );
  write(
    join(claudeDir, 'plugins', 'known_marketplaces.json'),
    JSON.stringify({ 'agentdev-kevin': { source: { source: 'directory', path: '/code/agent-kevin' } }, agentlayer: { source: { source: 'github' } } })
  );

  test('lists each home once, with its name, version, install and whether it moved', () => {
    expect(listHomes('agent-kevin', claudeDir)).toEqual([
      { home: kevin, name: 'Kevin', version: '0.9.5', movedTo: null, install: 'dev', marketplace: 'agentdev-kevin', checkout: '/code/agent-kevin' },
      { home: scout, name: 'Scout', version: '0.9.3', movedTo: null, install: 'dev', marketplace: 'agentdev-kevin', checkout: '/code/agent-kevin' },
      { home: moved, name: 'Old', version: '0.9.5', movedTo: '/elsewhere/Oppi', install: 'marketplace', marketplace: 'agentlayer', checkout: null }
    ]);
  });

  test('the home it runs from is listed even when its install is for the whole account', () => {
    const solo = home('Solo', { plugin: 'agent-kevin', templateVersion: '0.9.5' }, 'Kevin');
    write(join(solo, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'agent-kevin@agentlayer': true } }));
    expect(listHomes('agent-kevin', join(root, 'nowhere'), solo)).toEqual([
      { home: solo, name: 'Kevin', version: '0.9.5', movedTo: null, install: 'marketplace', marketplace: 'agentlayer', checkout: null }
    ]);
    expect(listHomes('agent-kevin', claudeDir, kevin).map((entry) => entry.home)).toEqual([kevin, scout, moved]);
  });

  test('a machine with no registry has no homes', () => {
    expect(listHomes('agent-kevin', join(root, 'nowhere'))).toEqual([]);
  });
});

describe('keepCandidates', () => {
  test('quotes every renamed and reviewed line by path and line, under its section', () => {
    const text = keepCandidates({
      blockers: ['the home has changes its history has not committed; run sync first'],
      persona: [
        { path: 'AGENTS.md', line: 4, before: 'Kevin runs the sync.' },
        { path: 'projects/acme/helpdesk.md', line: 48, before: "Ada's Kevin triages the queue." }
      ],
      review: [{ path: 'knowledge/x.md', line: 2, before: 'Ask Kevin, the other agent.' }],
      manual: ['IDENTITY.md:9: about the old mascot, kept as written for you to rewrite']
    });
    expect(text).toContain("projects/acme/helpdesk.md:48 | Ada's Kevin triages the queue.");
    expect(text).toContain('## Renamed (2)');
    expect(text).toContain('knowledge/x.md:2 | Ask Kevin, the other agent.');
    expect(text).toContain('## Kept for the operator to rewrite (1)');
    expect(text.indexOf('## Blockers (1)')).toBe(0);
  });
});
