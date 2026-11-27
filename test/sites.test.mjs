import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OPSCODE_JOBS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-sites-'));
const R = await import('../src/records.mjs');
const { runTool } = await import('../src/tools.mjs');
const manifest = JSON.parse(fs.readFileSync(new URL('../agent/manifest.json', import.meta.url), 'utf8'));

const NEW_JOB = ['foundit', 'shine', 'timesjobs', 'hirist', 'cutshort', 'wellfound', 'internshala', 'weworkremotely'];
const NEW_FREELANCE = ['guru', 'peopleperhour'];

test('0.6.0: ten more sites, each with a search link (checked against the sites) and the right kind', () => {
  for (const s of NEW_JOB) assert.equal(R.SITES[s].kind, 'job', s);
  for (const s of NEW_FREELANCE) assert.equal(R.SITES[s].kind, 'freelance', s);
  const u = (site, location) => R.searchUrl({ site, query: 'React Developer', location });
  assert.equal(u('foundit', 'Bengaluru'), 'https://www.foundit.in/srp/results?query=React%20Developer&locations=Bengaluru');
  assert.equal(u('foundit', 'Remote'), 'https://www.foundit.in/srp/results?query=React%20Developer');
  assert.equal(u('shine', 'Bengaluru'), 'https://www.shine.com/job-search/react-developer-jobs-in-bengaluru');
  assert.equal(u('timesjobs'), 'https://www.timesjobs.com/job-search?searchType=personalizedSearch&from=submit&txtKeywords=React%20Developer');
  assert.equal(u('hirist', 'Pune'), 'https://www.hirist.tech/search/react-developer');
  assert.equal(u('cutshort'), 'https://cutshort.io/jobs/react-developer-jobs');
  assert.equal(u('wellfound', 'Bangalore'), 'https://wellfound.com/role/l/react-developer/bangalore');
  assert.equal(u('wellfound', 'remote'), 'https://wellfound.com/role/r/react-developer');
  assert.equal(u('internshala', 'Delhi'), 'https://internshala.com/jobs/keywords-react-developer/');
  assert.equal(u('weworkremotely'), 'https://weworkremotely.com/remote-jobs/search?term=React%20Developer');
  assert.equal(u('guru'), 'https://www.guru.com/d/jobs/skill/react-developer/');
  assert.equal(u('peopleperhour'), 'https://www.peopleperhour.com/freelance-jobs?keywords=React%20Developer');
});

test('public listings are searched without waiting; Naukri, LinkedIn, Indeed and Freelancer wait for the user\'s yes', async () => {
  R.searchAdd({ site: 'shine', query: 'react developer' });
  R.searchAdd({ site: 'naukri', query: 'react developer' });
  const l = await runTool('jobs_search_list', {});
  const by = Object.fromEntries(l.data.map((x) => [x.site, x]));
  assert.equal(by.shine.needs_sign_in, false);
  assert.equal(by.naukri.needs_sign_in, true);
  assert.match(l.text, /Not signed in yet: Naukri\./);
  assert.doesNotMatch(l.text, /Not signed in yet:[^\n]*Shine/);
  const st = await runTool('jobs_login_status', {});
  assert.equal(st.data.find((x) => x.site === 'shine').login_url, 'https://www.shine.com/myshine/login/');
});

test('applying on a new site needs the user signed in there, and stops before the last button', async () => {
  R.profileSet({ name: 'Asha', skills: ['React', 'TypeScript'], years: 4 });
  R.jobsAdd({ site: 'shine', jobs: [{ title: 'React Developer', company: 'Kite', url: 'https://www.shine.com/jobs/react-developer/kite/1', description: 'React, TypeScript' }] });
  const j = R.jobsList({ all: true }).find((x) => x.company === 'Kite');
  R.jobsDraft({ job: j.id, text: 'Dear Kite team, I would like to apply for the React Developer role. For four years I have built React front ends in TypeScript, most recently a dashboard used by two thousand sales staff every day. I moved our main app to a typed codebase and cut page load time by a third, and I set up the component library my team still uses today. I would be glad to show you that work and talk about how I can help Kite ship faster. Regards, Asha' });
  const no = await runTool('jobs_apply_task', { job: j.id });
  assert.match(no.text, /not confirmed being signed in to Shine\. Fix: open https:\/\/www\.shine\.com\/myshine\/login\//);
  await runTool('jobs_login_mark', { site: 'shine', signed_in: true });
  const yes = await runTool('jobs_apply_task', { job: j.id });
  assert.equal(yes.ok, true, yes.text);
  assert.equal(yes.data.submit, false, 'not proven yet: the user presses the last button');
});

test('the setup offers all fourteen sites; the blocked ones are named and never worked around', () => {
  const opts = manifest.setup.fields.find((f) => f.id === 'sites').options.map((o) => o.value);
  assert.deepEqual(opts, ['naukri', 'linkedin', 'indeed', ...NEW_JOB, 'freelancer', ...NEW_FREELANCE]);
  assert.ok(opts.every((s) => R.SITES[s]), 'every choice is a known site');
  assert.match(manifest.systemPrompt, /Upwork, Glassdoor, Instahyre, Workana, Truelancer and RemoteOK are not supported/);
  assert.ok(manifest.version.localeCompare('0.6.0', undefined, { numeric: true }) >= 0, 'the sites came in 0.6.0');
});
