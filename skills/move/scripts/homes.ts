#!/usr/bin/env bun
/**
 * Every home this plugin is installed for on this machine, for the move skill to offer: its agent's
 * name, the version it was last upgraded to, whether it has already moved, and whether it loads the
 * plugin from a checkout (dev) or the marketplace. Read-only. Prints JSON.
 *
 * Usage: bun homes.ts [--claude-dir <dir>]   (run from inside a home)
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const NAME_FIELD = /^.*?\*\*Name:\*\*[ \t]*(.*?)[ \t]*$/m;

export interface Home {
  home: string;
  name: string;
  version: string | null;
  movedTo: string | null;
  install: 'dev' | 'marketplace';
  marketplace: string;
}

const readJson = (path: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** The marketplace a home enables `plugin` from in its own settings, for an install the registry files under no folder. */
const marketplaceIn = (home: string, plugin: string): string | null =>
  ['settings.local.json', 'settings.json']
    .flatMap((file) => Object.keys((readJson(join(home, '.claude', file))?.enabledPlugins as object | undefined) ?? {}))
    .find((id) => id.startsWith(`${plugin}@`))
    ?.slice(plugin.length + 1) ?? null;

/**
 * The homes `plugin` is installed for in `claudeDir`'s registry, plus `current` (the home the move runs
 * from, which an install for the whole account files under no folder), each read from its own `.state/version.json`.
 */
export const listHomes = (plugin: string, claudeDir: string, current?: string): Home[] => {
  const installed = readJson(join(claudeDir, 'plugins', 'installed_plugins.json'))?.plugins;
  const known = readJson(join(claudeDir, 'plugins', 'known_marketplaces.json')) ?? {};
  const entries = Object.entries(typeof installed === 'object' && installed !== null ? installed : {})
    .filter(([id]) => id.startsWith(`${plugin}@`))
    .flatMap(([id, installs]) =>
      (Array.isArray(installs) ? installs : []).flatMap((install: unknown) => {
        const path = typeof install === 'object' && install !== null ? text((install as Record<string, unknown>).projectPath) : null;
        return path ? [{ home: resolve(path), marketplace: id.slice(plugin.length + 1) }] : [];
      })
    );
  const here = current ? [{ home: resolve(current), marketplace: marketplaceIn(resolve(current), plugin) ?? '' }] : [];
  const unique = [...new Map([...here, ...entries].map((entry) => [entry.home, entry])).values()];
  return unique.flatMap(({ home, marketplace }) => {
    const version = readJson(join(home, '.state', 'version.json'));
    if (version?.plugin !== plugin) {
      return [];
    }
    const identity = existsSync(join(home, 'IDENTITY.md')) ? readFileSync(join(home, 'IDENTITY.md'), 'utf-8') : '';
    const source = (known[marketplace] as { source?: { source?: unknown } } | undefined)?.source?.source;
    return [
      {
        home,
        name: NAME_FIELD.exec(identity)?.[1] || '',
        version: text(version.templateVersion),
        movedTo: text(version.movedTo),
        install: source === 'directory' ? 'dev' : 'marketplace',
        marketplace
      }
    ];
  });
};

if (import.meta.main) {
  const at = process.argv.indexOf('--claude-dir');
  const homeAbove = (dir: string): string | undefined =>
    existsSync(join(dir, '.state', 'version.json')) ? dir : resolve(dir, '..') === dir ? undefined : homeAbove(resolve(dir, '..'));
  const claudeDir = at >= 0 ? resolve(process.argv[at + 1]) : process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  const manifest = readJson(join(import.meta.dir, '..', '..', '..', '.claude-plugin', 'plugin.json'));
  const plugin = text(manifest?.name) ?? '';
  process.stdout.write(`${JSON.stringify({ installed: text(manifest?.version), homes: listHomes(plugin, claudeDir, homeAbove(process.cwd())) }, null, 2)}\n`);
}
