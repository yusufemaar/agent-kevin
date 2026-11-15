/**
 * Carry out a migration plan: copy the home to its new folder, give the copy its own history,
 * capture the sessions the move would miss, write the planned files and commit. The old home is
 * read, never written, except for the `movedTo` stamp a final run asks for.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { RUNTIME_DIR } from '@/shared/naming';
import { HOME_BINDING_KEY, historyInside } from '@/home/git-dir-record';
import { pinEnv } from '@/shared/settings-env';
import { MOVE_LOG, type Plan } from './plan';

export interface ApplyResult {
  home: string;
  history: string | null;
  captured: number;
  written: number;
  deleted: number;
  commits: string[];
  retired: boolean;
}

const git = (plan: Plan, args: string[]): string => {
  const where = plan.history ? ['--git-dir', plan.history.to, '--work-tree', plan.to] : ['-C', plan.to];
  return execFileSync('git', [...where, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
};

/** The copy has a history of its own: one kept outside it, or a `.git` folder inside it, never an enclosing repo's. */
const hasHistory = (plan: Plan): boolean => plan.history !== null || historyInside(plan.to);

/** Commit everything in the copy under `message`, when there is anything; the new commit's short id. */
const commitAll = (plan: Plan, message: string): string | null => {
  git(plan, ['add', '-A']);
  if (git(plan, ['status', '--porcelain']) === '') {
    return null;
  }
  git(plan, ['commit', '-q', '-m', message]);
  return git(plan, ['rev-parse', '--short', 'HEAD']);
};

interface Captured {
  id: string;
  turns: number;
}

/** Turns Claude Code holds for the old home that the brain lacks, appended to the copy's session logs. */
const captureInto = async (plan: Plan): Promise<Captured[]> => {
  if (plan.transcripts.length === 0) {
    return [];
  }
  pinEnv('AGENT_HOME', plan.to);
  // The copy's own knowledge folder, whatever the old home's process inherited.
  pinEnv('AGENT_KNOWLEDGE', join(plan.to, 'knowledge'));
  pinEnv('AGENT_LOG_FILE', 'off');
  const { captureSession } = await import('@/knowledge/session-capture');
  // One at a time: captures share a lock that a waiting capture gives up on after a moment.
  return plan.transcripts.reduce(async (saved, transcriptPath) => {
    const done = await saved;
    const id = basename(transcriptPath, '.jsonl');
    const result = await captureSession({ transcriptPath, cwd: plan.from, sessionId: id, mode: 'session-end' });
    return result.saved ? [...done, { id, turns: result.turns }] : done;
  }, Promise.resolve<Captured[]>([]));
};

export const applyMigration = async (plan: Plan, retire: boolean): Promise<ApplyResult> => {
  if (plan.blockers.length > 0) {
    throw new Error(`Nothing was copied:\n- ${plan.blockers.join('\n- ')}`);
  }
  try {
    return await copyAndRewrite(plan, retire);
  } catch (cause) {
    const leftovers = [plan.to, ...(plan.history ? [plan.history.to] : [])].filter((path) => existsSync(path));
    throw new Error(
      `The migration stopped partway and ${plan.from} is unchanged; ` +
        `delete ${leftovers.join(' and ') || 'nothing'} and run it again.`,
      { cause }
    );
  }
};

const copyAndRewrite = async (plan: Plan, retire: boolean): Promise<ApplyResult> => {
  mkdirSync(dirname(plan.to), { recursive: true });
  cpSync(plan.from, plan.to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true });

  if (plan.history) {
    mkdirSync(dirname(plan.history.to), { recursive: true });
    cpSync(plan.history.from, plan.history.to, { recursive: true, verbatimSymlinks: true, errorOnExist: true });
    writeFileSync(join(plan.to, '.git'), `gitdir: ${plan.history.to}\n`);
    execFileSync('git', ['--git-dir', plan.history.to, 'config', 'core.worktree', plan.to]);
    execFileSync('git', ['--git-dir', plan.history.to, 'config', HOME_BINDING_KEY, plan.to]);
  }
  const tracked = hasHistory(plan);
  const commits: string[] = [];

  const captured = await captureInto(plan);
  // Everything since the home's last sync came across uncommitted: the sessions just exited included.
  if (tracked) {
    const id = commitAll(plan, 'Carry over the sessions and changes since the last sync');
    if (id) {
      commits.push(id);
    }
  }

  plan.edits.forEach(({ path, text }) => {
    mkdirSync(dirname(join(plan.to, path)), { recursive: true });
    writeFileSync(join(plan.to, path), text);
  });
  plan.copies.forEach(({ from, to }) => {
    mkdirSync(dirname(join(plan.to, to)), { recursive: true });
    copyFileSync(from, join(plan.to, to));
  });
  plan.deletes.forEach((path) => rmSync(join(plan.to, path), { force: true }));
  const log = { at: new Date().toISOString(), from: plan.from, to: plan.to, history: plan.history, deletes: plan.deletes, captured, ...plan.report };
  mkdirSync(dirname(join(plan.to, MOVE_LOG)), { recursive: true });
  writeFileSync(join(plan.to, MOVE_LOG), `${JSON.stringify(log, null, 2)}\n`);
  if (tracked) {
    const id = commitAll(plan, 'Moved from agent-kevin');
    if (id) {
      commits.push(id);
    }
  }

  if (retire) {
    const versionPath = join(plan.from, RUNTIME_DIR, 'version.json');
    const version: unknown = JSON.parse(readFileSync(versionPath, 'utf-8'));
    const recorded = typeof version === 'object' && version !== null ? version : {};
    writeFileSync(versionPath, `${JSON.stringify({ ...recorded, movedTo: plan.to }, null, 2)}\n`);
  }

  return {
    home: plan.to,
    history: plan.history?.to ?? null,
    captured: captured.length,
    written: plan.edits.length,
    deleted: plan.deletes.length,
    commits,
    retired: retire
  };
};
