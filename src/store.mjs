// Where Job & Freelance Finder keeps its data: ~/.opscode/job-hunter (or $OPSCODE_JOBS_HOME).
// The profile, saved searches and the jobs found. No passwords or site cookies are stored here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function home() {
  return process.env.OPSCODE_JOBS_HOME || path.join(os.homedir(), '.opscode', 'job-hunter');
}

const file = (kind, id) => path.join(home(), kind, `${id}.json`);

export function readJson(kind, id, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file(kind, id), 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`${file(kind, id)} is not valid JSON (${e.message})`);
  }
}

/** Write atomically: a crash mid-write never leaves half a file. */
export function writeJson(kind, id, data) {
  const f = file(kind, id);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

export function removeJson(kind, id) {
  try { fs.unlinkSync(file(kind, id)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export function listIds(kind) {
  try { return fs.readdirSync(path.join(home(), kind)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort(); } catch { return []; }
}

/** An error the agent can act on: what is wrong and the exact fix. */
export class FixError extends Error {
  constructor(message, fix, details) { super(message); this.fix = fix; this.details = details; }
}
