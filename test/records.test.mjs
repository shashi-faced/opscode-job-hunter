import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OPSCODE_JOBS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-rec-'));
const R = await import('../src/records.mjs');

const PROFILE = { name: 'Asha', headline: 'React developer, 4 years', skills: ['React', 'Node.js', 'TypeScript'], years: 4, roles: ['react developer'], locations: ['bengaluru'], remote: true, min_salary_lpa: 12, avoid: ['php'] };
const page = [
  { title: 'React Developer', company: 'Acme', location: 'Bengaluru', salary: '15-20 Lacs PA', experience: '3-5 Yrs', posted: 'Today', url: 'https://www.naukri.com/job-listings-react-developer-acme-123?src=jobsearchDesk&sid=99', description: 'React, Node.js, TypeScript' },
  { title: 'PHP Developer', company: 'OldCo', location: 'Bengaluru', url: 'https://www.naukri.com/job-listings-php-456', description: 'PHP, Laravel' },
  { title: 'Data Entry', company: 'X' },
  { title: '', url: 'https://x.y' },
];

test('a search link is built for each known site', () => {
  assert.equal(R.searchUrl({ site: 'naukri', query: 'React Developer', location: 'Bengaluru' }), 'https://www.naukri.com/react-developer-jobs-in-bengaluru');
  assert.equal(R.searchUrl({ site: 'naukri', query: 'react', location: 'Remote' }), 'https://www.naukri.com/react-jobs?wfhType=2');
  assert.match(R.searchUrl({ site: 'linkedin', query: 'react developer', location: 'India' }), /keywords=react%20developer&location=India&sortBy=DD/);
  assert.equal(R.searchUrl({ site: 'freelancer', query: 'next.js' }), 'https://www.freelancer.com/search/projects?q=next.js');
  assert.equal(R.searchUrl({ site: 'upwork', query: 'next.js' }), null, 'Upwork is not supported (it blocks automated browsers)');
  assert.equal(R.searchUrl({ site: 'other', query: 'x' }), null);
});

test('saved searches: added once, listed, removed; "other" needs a link', () => {
  const a = R.searchAdd({ site: 'naukri', query: 'react developer', location: 'bengaluru' });
  assert.equal(a.search.kind, 'job');
  assert.equal(R.searchAdd({ site: 'naukri', query: 'react developer', location: 'bengaluru' }).existed, true);
  assert.equal(R.searchAdd({ site: 'freelancer', query: 'react' }).search.kind, 'freelance');
  assert.throws(() => R.searchAdd({ site: 'upwork', query: 'react' }), /unknown site/);
  assert.throws(() => R.searchAdd({ site: 'other', query: 'x' }), /url is missing/);
  assert.throws(() => R.searchAdd({ site: 'monster', query: 'x' }), /unknown site/);
  assert.equal(R.searchList().length, 2);
  R.searchRemove({ search: R.searchList().find((s) => s.site === 'freelancer').id });
  assert.equal(R.searchList().length, 1);
});

test('scoring needs a profile; the profile needs skills', () => {
  assert.throws(() => R.jobsScore(), /no profile yet/);
  assert.throws(() => R.profileSet({ name: 'A' }), /no skills/);
  assert.equal(R.profileSet(PROFILE).skills.length, 3);
});

test('jobs are kept once: tracking parts of links ignored, same title + company is the same job', () => {
  const s = R.searchList()[0];
  const r = R.jobsAdd({ site: 'naukri', search: s.id, jobs: page });
  assert.equal(r.added.length, 3);
  assert.equal(r.invalid.length, 1);
  const again = R.jobsAdd({ site: 'naukri', jobs: [{ ...page[0], url: 'https://naukri.com/job-listings-react-developer-acme-123?src=other' }, { title: 'React developer', company: 'ACME', url: 'https://www.linkedin.com/jobs/view/1/' }] });
  assert.equal(again.added.length, 0);
  assert.equal(again.repeats.length, 2);
  assert.equal(R.searchList()[0].lastFound, 3);
  assert.equal(R.normalizeUrl('https://in.indeed.com/viewjob?jk=abc&from=serp'), 'https://in.indeed.com/viewjob?jk=abc');
});

test('a longer description updates the job and it is scored again', () => {
  R.jobsScore();
  const before = R.jobsList({ all: true }).find((j) => j.company === 'Acme');
  assert.ok(before.score != null);
  const r = R.jobsAdd({ site: 'naukri', jobs: [{ ...page[0], description: `${page[0].description}. ${'Full job text. '.repeat(10)}` }] });
  assert.equal(r.updated.length, 1);
  assert.equal(R.getJob(before.id).score, null);
});

test('scores, best first; the avoided word sinks the PHP job; digest shows the fresh matches', () => {
  R.jobsScore();
  const l = R.jobsList({});
  assert.equal(l[0].company, 'Acme');
  assert.ok(l[0].score >= 80, `score ${l[0].score}`);
  const php = l.find((j) => j.company === 'OldCo');
  assert.ok(php.score <= 10);
  const d = R.jobsDigest({ hours: 24, min_score: 60 });
  assert.equal(d.found, 3);
  assert.deepEqual(d.matches.map((j) => j.company), ['Acme']);
});

test('status changes are recorded with a note; dismissed jobs leave the list', () => {
  const [acme] = R.jobsList({});
  const php = R.jobsList({}).find((j) => j.company === 'OldCo');
  R.jobsMark({ job: acme.id, status: 'applied', note: 'applied on Naukri' });
  R.jobsMark({ job: [php.id], status: 'dismissed' });
  assert.equal(R.getJob(acme.id).history.at(-1).to, 'applied');
  assert.equal(R.getJob(acme.id).note, 'applied on Naukri');
  assert.ok(!R.jobsList({}).some((j) => j.id === php.id));
  assert.equal(R.jobsList({ status: 'dismissed' }).length, 1);
  assert.throws(() => R.jobsMark({ job: acme.id, status: 'hired' }), /unknown status/);
  const st = R.jobsStatus();
  assert.equal(st.counts.applied, 1);
  assert.equal(st.total, 3);
});

test('a changed profile makes every job wait for a new score', () => {
  R.profileSet({ skills: ['Python'] });
  assert.ok(R.jobsList({ all: true }).every((j) => j.score == null));
});

test('CV text from .txt and .docx; a missing file says what to do', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  fs.writeFileSync(path.join(dir, 'cv.txt'), 'Asha K\nReact developer with 4 years of experience in React, Node.js and TypeScript at Acme.');
  assert.match(R.cvRead({ path: 'cv.txt' }, dir).text, /React developer/);
  assert.throws(() => R.cvRead({ path: 'nope.pdf' }, dir), /does not exist/);
  assert.throws(() => R.cvRead({ path: 'cv.txt' }, '/'), /does not exist/);
});
