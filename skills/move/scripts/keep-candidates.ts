#!/usr/bin/env bun
/**
 * A migrate preview, cut to what the keep review reads: the blockers, every line the rename would
 * change (`path:line | text`), the lines it would leave for review, and the lines kept for the
 * operator to rewrite. The preview's JSON is too long to read whole. Read-only.
 *
 * Usage: bun keep-candidates.ts <preview.json>
 */
import { readFileSync } from 'node:fs';

interface LineChange {
  path: string;
  line: number;
  before: string;
}

interface Preview {
  blockers?: string[];
  persona?: LineChange[];
  product?: LineChange[];
  review?: LineChange[];
  manual?: string[];
  leftovers?: string[];
}

const lines = (changes: LineChange[] = []): string[] => changes.map((change) => `${change.path}:${change.line} | ${change.before}`);

/** The preview as plain sections, each line one candidate the keep review can quote back. */
export const keepCandidates = (preview: Preview): string =>
  [
    `## Blockers (${preview.blockers?.length ?? 0})`,
    ...(preview.blockers ?? []),
    '',
    `## Renamed (${preview.persona?.length ?? 0}): keep a line when the old name there is someone or something else`,
    ...lines(preview.persona),
    '',
    `## Plugin name renamed (${preview.product?.length ?? 0}): keep a line when the old plugin's name there is a login or account, a document as sent or signed, or a fact the new name would make false`,
    ...lines(preview.product),
    '',
    `## Still used by the settings (${preview.leftovers?.length ?? 0}): a line naming one of these values is a login, so keep it`,
    ...(preview.leftovers ?? []),
    '',
    `## Left as written, for review (${preview.review?.length ?? 0})`,
    ...lines(preview.review),
    '',
    `## Kept for the operator to rewrite (${preview.manual?.length ?? 0})`,
    ...(preview.manual ?? [])
  ].join('\n');

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: bun keep-candidates.ts <preview.json>\n');
    process.exit(2);
  }
  process.stdout.write(`${keepCandidates(JSON.parse(readFileSync(path, 'utf-8')) as Preview)}\n`);
}
