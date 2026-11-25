import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/opscode-jobs.mjs');
const env = { ...process.env, OPSCODE_JOBS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-cli-')) };
const run = (args, cwd) => JSON.parse(execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, cwd }).trim().split('\n').pop());
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const tool = (name, params, cwd) => run(['tool', name, '--b64', b64(params)], cwd);

test('agent-manifest: id, uses the Browser Agent, every tool allowed, nothing that sends', () => {
  const { manifest } = run(['agent-manifest']);
  assert.equal(manifest.id, 'job-hunter');
  assert.deepEqual(manifest.uses, ['browser']);
  assert.equal(manifest.package.entry, 'bin/opscode-jobs.mjs');
  for (const t of manifest.package.tools) assert.ok(manifest.allowedTools.includes(t.name), `${t.name} allowed`);
  for (const t of ['write_file', 'bash', 'publish_video', 'publish_status', 'send_email']) assert.ok(!manifest.allowedTools.includes(t), `${t} not allowed`);
  assert.match(manifest.systemPrompt, /never apply/);
  assert.match(manifest.systemPrompt, /Never add a skill/);
  assert.deepEqual(manifest.setup.fields.map((f) => f.id), ['looking', 'sites', 'where', 'min']);
  const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(BIN), '..', 'package.json'), 'utf8'));
  assert.equal(manifest.version, pkg.version);
});

test('a whole run through the bridge: CV, profile, search, jobs, score, digest, mark', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-ws-'));
  fs.writeFileSync(path.join(dir, 'cv.md'), '# Ravi\nFull-stack developer, 5 years: React, Node.js, TypeScript, PostgreSQL. Bengaluru.');
  assert.match(tool('jobs_cv_read', { path: 'cv.md' }, dir).text, /Full-stack developer/);
  assert.equal(tool('jobs_profile_set', { skills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL'], years: 5, roles: ['full stack developer'], locations: ['bengaluru'], remote: true }).ok, true);
  const s = tool('jobs_search_add', { site: 'naukri', query: 'full stack developer', location: 'bengaluru' });
  assert.equal(s.data.url, 'https://www.naukri.com/full-stack-developer-jobs-in-bengaluru');
  const list = tool('jobs_search_list', {});
  assert.match(list.data[0].browser_task, /READ ONLY: do not click Apply/);
  assert.match(list.data[0].browser_task, /return ONLY a JSON array/);
  const add = tool('jobs_add', { site: 'naukri', search: s.data.id, jobs: [
    { title: 'Full Stack Developer', company: 'Zeta', location: 'Bengaluru', experience: '4-7 Yrs', posted: 'Today', url: 'https://www.naukri.com/job-listings-full-stack-zeta-1', description: 'React, Node.js, PostgreSQL' },
    { title: 'Java Developer', company: 'Beta', location: 'Chennai', url: 'https://www.naukri.com/job-listings-java-2', description: 'Java, Spring' },
  ] });
  assert.match(add.text, /Added 2 new job/);
  assert.match(tool('jobs_score', {}).text, /Scored 2 job/);
  const d = tool('jobs_digest', {});
  assert.equal(d.data.matches.length, 1);
  assert.match(d.text, /1\. \[\d+\] Full Stack Developer — Zeta/);
  const id = d.data.matches[0].id;
  assert.match(tool('jobs_mark', { job: id, status: 'shortlisted' }).text, /is now shortlisted/);
  assert.match(run(['status']).data ? JSON.stringify(run(['status']).data.counts) : '', /"shortlisted":1/);
});

test('errors name the fix', () => {
  const r = tool('jobs_mark', { job: 'nope', status: 'applied' });
  assert.equal(r.ok, false);
  assert.match(r.text, /Fix: use an id from jobs_list/);
  assert.match(tool('jobs_nothing', {}).text, /Unknown tool/);
});
