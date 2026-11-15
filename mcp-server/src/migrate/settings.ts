/**
 * The machine-read files `migrate` rewrites in a home's copy: Claude settings and `.mcp.json`, and
 * the Codex wiring the old plugin generated. Pure, like the text rules.
 */
import { type PathMove, SOURCE, TARGET, movePaths, productText } from './rules';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every string in a JSON value with the old home, checkout and history folder moved. */
const moveStrings = (value: Json, moves: PathMove[], userHome: string): Json => {
  if (typeof value === 'string') {
    return movePaths(value, moves, userHome);
  }
  if (Array.isArray(value)) {
    return value.map((item) => moveStrings(item, moves, userHome));
  }
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, moveStrings(item, moves, userHome)]));
  }
  return value;
};

/** A grant that only worked while the old CLI sat on the Bash PATH. */
const OLD_CLI_GRANT = new RegExp(`^Bash\\(${SOURCE.server} `);

const migrateGrants = (entries: Json): Json =>
  Array.isArray(entries)
    ? [
        ...new Set(
          entries.flatMap((entry) =>
            typeof entry !== 'string' ? [] : OLD_CLI_GRANT.test(entry) ? [] : [productText(entry)]
          )
        )
      ]
    : entries;

const renameKeys = (value: Json | undefined): Json | undefined =>
  isObject(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [productText(key), item])) : value;

const OLD_CLI = /bin[\\/]kevin(?![\w.-])/;

/**
 * A Claude settings file or `.mcp.json` for the new plugin: grants and plugin keys renamed, the
 * status line the new plugin's upgrade rewrites dropped, and every path to the old home, checkout
 * and history moved. Any other value, a login that happens to read `agent-kevin` included, is kept.
 */
export const migrateSettings = (settings: JsonObject, moves: PathMove[], userHome: string): JsonObject => {
  const permissions = isObject(settings.permissions)
    ? Object.fromEntries(
        Object.entries(settings.permissions).map(([list, entries]) => [
          list,
          ['allow', 'ask', 'deny'].includes(list) ? migrateGrants(entries) : entries
        ])
      )
    : settings.permissions;
  const statusLine =
    isObject(settings.statusLine) && typeof settings.statusLine.command === 'string' && OLD_CLI.test(settings.statusLine.command)
      ? undefined
      : settings.statusLine;
  const next: JsonObject = Object.fromEntries(
    Object.entries({
      ...settings,
      permissions,
      enabledPlugins: renameKeys(settings.enabledPlugins),
      extraKnownMarketplaces: renameKeys(settings.extraKnownMarketplaces),
      statusLine
    }).filter((entry): entry is [string, Json] => entry[1] !== undefined)
  );
  const moved = moveStrings(next, moves, userHome);
  return isObject(moved) ? moved : next;
};

/** Strings left in a migrated file that still name the old plugin, for the report. */
export const leftovers = (value: Json, path = ''): string[] => {
  if (typeof value === 'string') {
    return /agent-kevin|bin[\\/]kevin|mcp__plugin_agent-kevin/.test(value) ? [`${path}: ${value}`] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leftovers(item, `${path}[${index}]`));
  }
  if (isObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(/agent-kevin/.test(key) ? [`${path}.${key}`] : []),
      ...leftovers(item, path ? `${path}.${key}` : key)
    ]);
  }
  return [];
};

/** The old plugin's server and profile tables, and a table switching the new plugin off (set while the home ran the old one). */
const CODEX_TABLE = new RegExp(
  `^\\[(?:(?:mcp_servers|permissions)\\.${SOURCE.server}(?:\\.[^\\]]*)?|plugins\\."${TARGET.plugin}@[^"]*")\\]\\s*(?:#.*)?$`
);
const ANY_TABLE = /^\s*\[/;
const CODEX_DEFAULT = new RegExp(`^default_permissions\\s*=\\s*"${SOURCE.server}"\\s*$`);

/**
 * Codex's `config.toml` without the old plugin's tables (its MCP server, its permission profile)
 * or its default profile, other paths moved. The new plugin's upgrade writes its own. Codex enables a
 * plugin for every folder, so each old plugin id it has (`oldPlugins`) is switched off for this home.
 */
export const migrateCodexConfig = (toml: string, moves: PathMove[], userHome: string, oldPlugins: string[]): string => {
  let dropping = false;
  const kept = toml.split('\n').filter((line) => {
    if (ANY_TABLE.test(line)) {
      dropping = CODEX_TABLE.test(line.trim());
    }
    return !dropping && !CODEX_DEFAULT.test(line.trim());
  });
  const disables = oldPlugins
    .filter((id) => !kept.some((line) => line.trim() === `[plugins."${id}"]`))
    .flatMap((id) => ['', `[plugins."${id}"]`, 'enabled = false', '']);
  return movePaths([...kept, ...disables].join('\n').replace(/\n{3,}/g, '\n\n'), moves, userHome);
};

/** Codex's `hooks.json` without the old plugin's hooks; the operator's own stay. */
export const migrateCodexHooks = (hooks: JsonObject): JsonObject => {
  const events = isObject(hooks.hooks) ? hooks.hooks : {};
  const kept = Object.fromEntries(
    Object.entries(events).flatMap(([event, groups]): [string, Json][] => {
      const remaining = (Array.isArray(groups) ? groups : []).flatMap((group): Json[] => {
        if (!isObject(group) || !Array.isArray(group.hooks)) {
          return [group];
        }
        const own = group.hooks.filter((hook) => !(isObject(hook) && typeof hook.command === 'string' && OLD_CLI.test(hook.command)));
        return own.length > 0 ? [{ ...group, hooks: own }] : [];
      });
      return remaining.length > 0 ? [[event, remaining]] : [];
    })
  );
  return { ...hooks, hooks: kept };
};

export type { Json, JsonObject };
