import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OPSCODE_JOBS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-login-'));
const R = await import('../src/records.mjs');
const { runTool, TOOL_DEFS, APP_TOOLS } = await import('../src/tools.mjs');
const manifest = JSON.parse(fs.readFileSync(new URL('../agent/manifest.json', import.meta.url), 'utf8'));

R.profileSet({ name: 'Asha', skills: ['React'], years: 4 });
R.searchAdd({ site: 'naukri', query: 'react developer' });
R.searchAdd({ site: 'freelancer', query: 'react' });

test('a new site is not signed in: the status names its sign-in page, and the search list says to sign in first', async () => {
  const s = await runTool('jobs_login_status', {});
  assert.equal(s.ok, true, s.text);
  assert.deepEqual(s.data.map((x) => [x.site, x.signed_in]), [['freelancer', false], ['naukri', false]]);
  assert.equal(s.data.find((x) => x.site === 'naukri').login_url, 'https://www.naukri.com/nlogin/login');
  const l = await runTool('jobs_search_list', {});
  assert.match(l.text, /Not signed in yet: (Naukri, Freelancer|Freelancer, Naukri)\. Before searching those, open each with open_sign_in/);
  assert.ok(l.data.every((x) => x.signed_in === false && x.browser_task));
});

test('the user\'s answer is recorded: yes signs the site in, skip leaves it out; nothing else is stored', async () => {
  const yes = await runTool('jobs_login_mark', { site: 'naukri', signed_in: true });
  assert.match(yes.text, /Naukri: signed in, as the user said/);
  const skip = await runTool('jobs_login_mark', { site: 'freelancer', signed_in: false, skip: true });
  assert.match(skip.text, /Freelancer: skipped for now/);
  const s = await runTool('jobs_login_status', {});
  assert.deepEqual(s.data.map((x) => [x.site, x.signed_in, x.skipped]), [['freelancer', false, true], ['naukri', true, false]]);
  const saved = fs.readFileSync(path.join(process.env.OPSCODE_JOBS_HOME, 'logins', 'state.json'), 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(saved).naukri).sort(), ['at', 'signed_in', 'skipped'], 'no password, code or cookie');
  assert.equal((await runTool('jobs_login_mark', { site: 'monster', signed_in: true })).ok, false);
});

test('an application on a site the user has not confirmed is refused with the way to sign in', async () => {
  R.jobsAdd({ site: 'freelancer', jobs: [{ title: 'React dashboard', company: 'Blue', url: 'https://www.freelancer.com/projects/react/react-dashboard-1', description: 'React' }] });
  const job = R.jobsList({ all: true }).find((j) => j.company === 'Blue');
  R.jobsDraft({ job: job.id, text: 'Your dashboard needs fast, clear charts that load quickly for every user on the team. I have built React dashboards for four years, including one used by two thousand sales staff every day, with typed components and a shared design system. I would start by reviewing your current screens, then deliver the first working view within a week so you can see progress early. Happy to answer any questions about the approach here on Freelancer.' });
  const r = await runTool('jobs_apply_task', { job: job.id });
  assert.equal(r.ok, false);
  assert.match(r.text, /not confirmed being signed in to Freelancer\. Fix: open https:\/\/www\.freelancer\.com\/login/);
  await runTool('jobs_login_mark', { site: 'freelancer', signed_in: true });
  assert.equal((await runTool('jobs_apply_task', { job: job.id })).ok, true);
});

test('Upwork is gone (it blocks automated browsers): no sign-in, no search, an old saved Upwork search is removed', async () => {
  assert.equal((await runTool('jobs_login_mark', { site: 'upwork', signed_in: true })).ok, false);
  assert.equal((await runTool('jobs_search_add', { site: 'upwork', query: 'react' })).ok, false);
  fs.writeFileSync(path.join(process.env.OPSCODE_JOBS_HOME, 'searches', 'upwork-react.json'), JSON.stringify({ id: 'upwork-react', site: 'upwork', kind: 'freelance', query: 'react', url: 'https://www.upwork.com/nx/search/jobs/?q=react' }));
  const l = await runTool('jobs_search_list', {});
  assert.ok(l.ok, l.text);
  assert.ok(!l.data.some((x) => x.site === 'upwork'));
  assert.equal(fs.existsSync(path.join(process.env.OPSCODE_JOBS_HOME, 'searches', 'upwork-react.json')), false);
  assert.ok(!manifest.setup.fields.find((f) => f.id === 'sites').options.some((o) => o.value === 'upwork'), 'not offered in setup');
  assert.match(manifest.systemPrompt, /Upwork is not supported: it blocks automated browsers[\s\S]*never try to get around a site's block/);
});

test('the agent opens the page and asks with buttons; it never asks for a password; only the user\'s answer marks a site', () => {
  for (const t of ['jobs_login_status', 'jobs_login_mark', 'open_sign_in', 'ask_question']) assert.ok(manifest.allowedTools.includes(t), t);
  assert.ok(TOOL_DEFS.some((t) => t.name === 'jobs_login_mark') && !APP_TOOLS.includes('jobs_login_mark'));
  const p = manifest.systemPrompt;
  assert.match(p, /open_sign_in with the site's login_url/);
  assert.match(p, /ask_question: "I opened <Site> in the browser window\. Sign in there yourself/);
  assert.match(p, /"Yes, I'm signed in", "Not yet, give me a minute" and "Skip <Site> for now"/);
  assert.match(p, /You never ask for, type or store a password, code or OTP/);
});
