// Builds INDEX.jsonl and INDEX.md from source records only.
import fs from 'node:fs';
import path from 'node:path';
import { COMPARTMENTS, writeFileAtomic } from './util.mjs';
import { listRecordFiles, analyzeRecord } from './records.mjs';

function entry(r) {
  return {
    path: r.path,
    compartment: r.compartment,
    title: r.title,
    date: r.date,
    status: r.status,
    tags: r.tags,
    summary: r.summary,
    metadata: r.metadata,
  };
}

function mdEscape(s) {
  return String(s).replace(/([\\[\]*_`])/g, '\\$1');
}

function renderMd(recs) {
  const lines = [
    '# Index',
    '',
    'Generated from source records by `node system/bin/brain.mjs index`. Do not edit by hand.',
    'Search this file (or INDEX.jsonl) first, then open only the records you need.',
    '',
  ];
  if (!recs.length) {
    lines.push('Records: 0', '', 'No records yet. See MAP.md for where records go.', '');
    return lines.join('\n');
  }
  const incomplete = recs.filter((r) => r.metadata === 'incomplete').length;
  const invalid = recs.filter((r) => r.metadata === 'invalid').length;
  lines.push(`Records: ${recs.length} (metadata incomplete: ${incomplete}, invalid: ${invalid})`, '');
  for (const comp of COMPARTMENTS) {
    const group = recs.filter((r) => r.compartment === comp);
    if (!group.length) continue;
    lines.push(`## ${comp}`, '');
    for (const r of group) {
      const title = r.title ? mdEscape(r.title) : `(untitled) ${mdEscape(path.posix.basename(r.path))}`;
      let line = `- ${r.date || 'undated'} | ${r.status} | [${title}](${encodeURI(r.path)})`;
      if (r.tags.length) line += ` | tags: ${r.tags.join(', ')}`;
      if (r.metadata !== 'complete') line += ` | metadata ${r.metadata}`;
      if (r.summary) line += ` | ${mdEscape(r.summary)}`;
      lines.push(line);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function buildIndex(root) {
  const { files, skipped } = listRecordFiles(root);
  return buildIndexFrom(files.map((f) => analyzeRecord(root, f)), skipped);
}

// Render the index for records already analyzed and sorted by path.
export function buildIndexFrom(recs, skipped = []) {
  const jsonl = recs.map((r) => JSON.stringify(entry(r))).join('\n') + (recs.length ? '\n' : '');
  return { recs, skipped, jsonl, md: renderMd(recs) };
}

export function writeIndex(root) {
  const built = buildIndex(root);
  writeFileAtomic(path.join(root, 'INDEX.jsonl'), built.jsonl);
  writeFileAtomic(path.join(root, 'INDEX.md'), built.md);
  return built;
}

export function checkIndex(root) {
  const built = buildIndex(root);
  const stale = [];
  for (const [name, expected] of [['INDEX.jsonl', built.jsonl], ['INDEX.md', built.md]]) {
    let actual = null;
    try {
      actual = fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
    } catch {
      /* missing counts as stale */
    }
    if (actual !== expected) stale.push(name);
  }
  return { fresh: stale.length === 0, stale, built };
}
