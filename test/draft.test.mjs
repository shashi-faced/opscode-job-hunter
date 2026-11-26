import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OPSCODE_JOBS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-draft-'));
const { checkDraft } = await import('../src/draft.mjs');
const R = await import('../src/records.mjs');
const { runTool, TOOL_DEFS, APP_TOOLS } = await import('../src/tools.mjs');
// The user confirmed signing in to the sites (applications need it; see logins.test.mjs).
const L = await import('../src/logins.mjs');
for (const site of ['naukri', 'linkedin', 'indeed', 'freelancer']) L.loginMark({ site, signed_in: true });

const profile = { name: 'Asha K', skills: ['React', 'Node.js', 'TypeScript'], years: 4, locations: ['bengaluru'], remote: true, cv_path: '/home/asha/cv.pdf' };
const job = { title: 'React Developer', company: 'Acme', skills: ['React', 'GraphQL'] };
const LETTER = `Dear Acme team,

I would like to apply for the React Developer role. For the last 4 years I have built React and TypeScript front ends, most recently a dashboard used by 2,000 sales staff, and Node.js services behind them.

At my current company I moved our main app to TypeScript, cut page load time by a third, and set up the component library the team still uses. Your posting mentions a fast-growing product with a small team, which is the kind of place where I do my best work.

I would be glad to show you the dashboard and talk about how I could help Acme ship faster.

Regards,
Asha K`;

test('a true, finished letter passes', () => {
  const r = checkDraft(LETTER, { job, profile, kind: 'cover_letter' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.words > 60);
});

test('a skill or years the profile does not have are refused, with the fix', () => {
  const r = checkDraft(LETTER.replace('React and TypeScript front ends', 'React, GraphQL and TypeScript front ends').replace('last 4 years', 'last 7 years'), { job, profile, kind: 'cover_letter' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /"graphql" as the user's skill/.test(e.error)), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => /"7 years" claims more experience than the profile \(4 years\)/.test(e.error)));
  assert.match(r.errors[0].fix, /remove it|say 4 years/);
});

test('saying plainly what the user has not used, or naming the client\'s stack, is fine', () => {
  const extra = `${LETTER}\n\nI have not used GraphQL yet, but I am keen to learn it. I saw your team uses Django on the back end.`;
  assert.equal(checkDraft(extra, { job, profile, kind: 'cover_letter' }).ok, true);
});

test('placeholders, wrong length and contact details in proposals are refused', () => {
  assert.match(checkDraft(LETTER.replace('Acme team', '[Company] team'), { job, profile, kind: 'cover_letter' }).errors[0].error, /placeholder/);
  assert.match(checkDraft('I can do it.', { job, profile, kind: 'proposal' }).errors[0].error, /too short/);
  const prop = `${LETTER}\nWrite to me at asha@example.com or WhatsApp +91 98765 43210.`;
  assert.ok(checkDraft(prop, { job, profile, kind: 'proposal' }).errors.some((e) => /contact information/.test(e.error)));
  assert.ok(checkDraft(prop, { job, profile, kind: 'cover_letter' }).errors.every((e) => !/contact information/.test(e.error)), 'a cover letter may carry an e-mail');
});

test('the user\'s own edit: only the hard limits apply', () => {
  assert.equal(checkDraft('Short note from me, I know GraphQL well.', { job, profile, kind: 'cover_letter', byUser: true }).ok, true);
  assert.equal(checkDraft('Hi [Name]', { job, profile, kind: 'cover_letter', byUser: true }).ok, false);
});

test('drafts wait for the user; only the app records the result; "sent" marks the job applied', async () => {
  R.profileSet(profile);
  R.jobsAdd({ site: 'naukri', jobs: [{ title: 'React Developer', company: 'Acme', url: 'https://www.naukri.com/job-listings-react-acme-1', description: 'React, TypeScript' }] });
  R.jobsAdd({ site: 'freelancer', jobs: [{ title: 'React dashboard', company: 'Client', url: 'https://www.freelancer.com/projects/react/react-dashboard-1', description: 'React' }] });
  const all = R.jobsList({ all: true }); const naukri = all.find((j) => j.site === 'naukri'); const gig = all.find((j) => j.site === 'freelancer');
  const bad = await runTool('jobs_draft', { job: naukri.id, text: LETTER.replace('last 4 years', 'last 9 years') });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /Not kept: 1 problem/);
  const ok = await runTool('jobs_draft', { job: naukri.id, text: LETTER });
  assert.equal(ok.ok, true, ok.text);
  assert.match(ok.text, /one click there applies/);
  assert.equal(R.getJob(naukri.id).status, 'shortlisted');
  const prop = await runTool('jobs_draft', { job: gig.id, text: LETTER.replace('Dear Acme team,', 'Your dashboard needs fast, clear charts.') });
  assert.equal(prop.ok, true, prop.text);
  assert.equal(prop.data.draft.kind, 'proposal');
  assert.equal(prop.data.draft.submit, false);
  assert.match(prop.text, /the user sends it/);
  assert.equal(R.jobsDrafts().length, 2);

  // The agent has the draft tools but not the ones that record the user's decision or build the apply task.
  const agentTools = TOOL_DEFS.map((t) => t.name);
  assert.ok(agentTools.includes('jobs_draft') && agentTools.includes('jobs_drafts'));
  for (const t of APP_TOOLS) assert.ok(!agentTools.includes(t), `${t} hidden from the agent`);

  const s = await runTool('jobs_draft_state', { job: naukri.id, state: 'sent', note: 'Naukri showed "Applied"' });
  assert.equal(s.ok, true);
  assert.equal(R.getJob(naukri.id).status, 'applied');
  assert.equal(R.getJob(naukri.id).history.at(-1).to, 'applied');
  const again = await runTool('jobs_draft', { job: naukri.id, text: LETTER });
  assert.match(again.text, /already sent/);
});

test('the apply task: job sites submit only this one application; freelance sites stop before Send', async () => {
  const all = R.jobsList({ all: true }); const naukri = all.find((j) => j.site === 'naukri'); const gig = all.find((j) => j.site === 'freelancer');
  R.jobsDraftState({ job: naukri.id, state: 'waiting' });
  const t = await runTool('jobs_apply_task', { job: naukri.id });
  assert.equal(t.data.submit, true);
  assert.match(t.text, /^USER CONFIRMED: the user approved this one application in the app: "React Developer at Acme on naukri"/);
  assert.match(t.text, /paste the text below EXACTLY/);
  assert.match(t.text, /do not guess/);
  assert.match(t.text, /CV file to upload when the form asks for one and none is attached: \/home\/asha\/cv\.pdf/);
  assert.ok(t.text.includes(LETTER));
  assert.match(t.text, /RESULT: SENT/);
  const u = await runTool('jobs_apply_task', { job: gig.id });
  assert.equal(u.data.submit, false);
  assert.doesNotMatch(u.text, /USER CONFIRMED/);
  assert.match(u.text, /do NOT click Send/);
});
