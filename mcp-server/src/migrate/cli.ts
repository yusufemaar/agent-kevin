/**
 * `kevin migrate`: move this home to a new folder for the agentlayer plugin. A dry run unless
 * `--apply`; `--retire` also stamps this home as moved. Prints one JSON report.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { FOLDERS } from '@/config';
import { canonicalPath } from '@/home/git-dir-record';
import { isInside } from '@/shared/paths';
import { applyMigration } from './apply';
import { planMigration } from './plan';

const USAGE =
  'Usage: migrate --to <new folder> [--name <Name>] [--emoji <emoji>] [--avatar <image>] [--welcome <move note>] [--keep <path>[:<line>]]... [--checkout <agentlayer checkout>] [--apply [--retire]]';

const VALUE_FLAGS = ['to', 'name', 'emoji', 'avatar', 'welcome', 'keep', 'checkout'];
const SWITCHES = ['apply', 'retire'];

/** The first argument that is neither a known flag nor a flag's value: a typo would otherwise drop it silently. */
const strayArgument = (argv: string[]): string | undefined =>
  argv.find((arg, index) => {
    const flag = arg.startsWith('--') ? arg.slice(2).split('=')[0] : undefined;
    if (flag !== undefined) {
      return !VALUE_FLAGS.includes(flag) && !SWITCHES.includes(flag);
    }
    const previous = argv[index - 1];
    return !(previous?.startsWith('--') && !previous.includes('=') && VALUE_FLAGS.includes(previous.slice(2)));
  });

export const runMigrate = async (argv: string[], home: string, pluginVersion: string, pluginRoot: string): Promise<number> => {
  const stray = strayArgument(argv);
  if (stray !== undefined) {
    console.error(`migrate doesn't know "${stray}"; nothing was read or written.\n${USAGE}`);
    return 1;
  }
  // The home that moves is the one you stand in: an AGENT_HOME from elsewhere would move the wrong home.
  if (!isInside(canonicalPath(process.cwd()), canonicalPath(home))) {
    console.error(`migrate runs from inside the home it moves, but this folder resolves to ${home}. Unset AGENT_HOME, or cd into ${home}.`);
    return 1;
  }
  const value = (name: string): string | undefined => {
    const inline = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (inline) {
      return inline.slice(name.length + 3);
    }
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const values = (name: string): string[] =>
    argv.flatMap((arg, index) =>
      arg === `--${name}` ? [argv[index + 1] ?? ''] : arg.startsWith(`--${name}=`) ? [arg.slice(name.length + 3)] : []
    );
  const path = (raw: string | undefined): string | undefined =>
    raw === undefined ? undefined : resolve(raw.replace(/^~(?=\/|$)/, homedir()));

  const to = path(value('to'));
  if (!to || !isAbsolute(to)) {
    console.error(USAGE);
    return 1;
  }
  const apply = argv.includes('--apply');
  const retire = argv.includes('--retire');
  if (retire && !apply) {
    console.error('--retire only goes with --apply, on the run that moves the home for good.');
    return 1;
  }
  const plan = planMigration({
    home,
    to,
    name: value('name'),
    emoji: value('emoji'),
    avatar: path(value('avatar')),
    welcome: path(value('welcome')),
    keep: values('keep'),
    checkout: path(value('checkout')),
    sourceCheckout: existsSync(join(pluginRoot, '.git')) ? pluginRoot : undefined,
    userHome: homedir(),
    pluginVersion,
    roots: { knowledge: FOLDERS.KNOWLEDGE, projects: FOLDERS.PROJECTS, reports: FOLDERS.REPORTS },
    claudeProjects: join(homedir(), '.claude', 'projects'),
    stateRoot: join(homedir(), '.local', 'state')
  });
  const summary = {
    from: plan.from,
    to: plan.to,
    history: plan.history,
    blockers: plan.blockers,
    files: plan.edits.length,
    deletes: plan.deletes,
    transcriptsToCapture: plan.transcripts.length,
    ...plan.report
  };
  if (!apply || plan.blockers.length > 0) {
    console.log(JSON.stringify({ mode: 'dry-run', ...summary }, null, 2));
    return plan.blockers.length > 0 && apply ? 2 : 0;
  }
  const result = await applyMigration(plan, retire);
  console.log(JSON.stringify({ mode: 'applied', ...summary, result }, null, 2));
  return 0;
};
