import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OPSCODE_JOBS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-msg-'));
const R = await import('../src/records.mjs');
const M = await import('../src/messages.mjs');
const { runTool, TOOL_DEFS, APP_TOOLS } = await import('../src/tools.mjs');
// The user confirmed signing in to the sites (applications need it; see logins.test.mjs).
const L = await import('../src/logins.mjs');
for (const site of ['naukri', 'linkedin', 'indeed', 'freelancer']) L.loginMark({ site, signed_in: true });

R.profileSet({ name: 'Asha', skills: ['React', 'Node.js'], years: 4 });
R.jobsAdd({ site: 'naukri', jobs: [{ title: 'React Developer', company: 'Acme Tech', url: 'https://www.naukri.com/job-listings-react-acme-1', description: 'React' }] });
R.jobsAdd({ site: 'freelancer', jobs: [{ title: 'React dashboard', company: 'Blue Co', url: 'https://www.freelancer.com/projects/react/react-dashboard-1', description: 'React' }] });
const acme = R.jobsList({ all: true }).find((j) => j.company === 'Acme Tech');
const blue = R.jobsList({ all: true }).find((j) => j.company === 'Blue Co');
R.jobsMark({ job: acme.id, status: 'applied' });

const naukriThread = { url: 'https://www.naukri.com/mnjuser/inbox/t1', from: 'Priya (HR)', company: 'Acme Tech', job_title: 'React Developer',
  messages: [{ from: 'Priya (HR)', mine: false, text: 'Hi Asha, thanks for applying. Are you free for a call this week?', at: '10:02' }] };

test('new messages from the other side need a reply and move the job to "replied"; repeats are ignored', async () => {
  const r = await runTool('jobs_messages_add', { site: 'naukri', threads: [naukriThread] });
  assert.equal(r.ok, true, r.text);
  assert.equal(r.data.fresh.length, 1);
  assert.equal(r.data.fresh[0].job, acme.id);
  assert.equal(R.getJob(acme.id).status, 'replied');
  const again = await runTool('jobs_messages_add', { site: 'naukri', threads: [naukriThread] });
  assert.equal(again.data.fresh.length, 0);
  const l = await runTool('jobs_inbox', {});
  assert.match(l.text, /Priya \(HR\) \(Acme Tech\) on naukri/);
});

test('a reply that accepts or commits for the user is refused; a plain one is kept and waits', async () => {
  const [t] = M.inbox();
  const bad = await runTool('jobs_reply_draft', { thread: t.id, text: 'Yes, I accept, see you on Monday.' });
  assert.equal(bad.ok, false);
  assert.match(bad.text, /accepts or agrees/);
  const ok = await runTool('jobs_reply_draft', { thread: t.id, text: 'Hi Priya, thank you for getting back to me. A call this week works well. Could you share two or three times that suit you? Asha' });
  assert.equal(ok.ok, true, ok.text);
  assert.match(ok.text, /waits for the user's Send/);
  assert.equal(M.getThread(t.id).reply.state, 'waiting');
});

test('money or commitment is marked for the user\'s own reading; contact details are refused on freelance sites', async () => {
  const r = await runTool('jobs_messages_add', { site: 'freelancer', threads: [{ url: 'https://www.freelancer.com/messages/thread/r1', from: 'Sam', company: 'Blue Co', job_title: 'React dashboard', messages: [{ from: 'Sam', text: 'Can you do it for $20/hr? Please share your WhatsApp.' }] }] });
  assert.equal(r.data.fresh[0].sensitive, true);
  assert.equal(r.data.fresh[0].job, blue.id);
  const id = r.data.fresh[0].id;
  const bad = await runTool('jobs_reply_draft', { thread: id, text: 'Sure, message me on WhatsApp +91 98765 43210.' });
  assert.match(bad.text, /contact information/);
  const ok = await runTool('jobs_reply_draft', { thread: id, text: 'Thanks Sam. I would like to discuss the rate here on Freelancer before we start. Could you share more about the dashboard?' });
  assert.equal(ok.ok, true, ok.text);
  assert.match(ok.text, /money or a commitment/);
});

test('only the app sends: the reply task says USER CONFIRMED for this one; "sent" records it and clears the conversation', async () => {
  const agentTools = TOOL_DEFS.map((t) => t.name);
  for (const t of APP_TOOLS) assert.ok(!agentTools.includes(t), `${t} hidden from the agent`);
  assert.ok(agentTools.includes('jobs_inbox') && agentTools.includes('jobs_reply_draft'));
  const t = M.inbox().find((x) => x.site === 'naukri');
  const task = await runTool('jobs_reply_task', { thread: t.id });
  assert.match(task.text, /^USER CONFIRMED: the user approved this one reply in the app, to Priya \(HR\) on naukri/);
  assert.match(task.text, /Conversation: https:\/\/www\.naukri\.com\/mnjuser\/inbox\/t1/);
  assert.ok(task.text.includes('A call this week works well.'));
  await runTool('jobs_reply_state', { thread: t.id, state: 'sent' });
  const after = M.getThread(t.id);
  assert.equal(after.needsReply, false);
  assert.equal(after.messages.at(-1).mine, true);
  assert.ok(!M.inbox().some((x) => x.id === t.id));
});

test('the inbox task is read only', async () => {
  const r = await runTool('jobs_inbox_task', { site: 'linkedin' });
  assert.match(r.text, /^Open https:\/\/www\.linkedin\.com\/messaging\/ in the browser/);
  assert.match(r.text, /READ ONLY: do not reply, send, accept/);
  assert.equal((await runTool('jobs_inbox_task', { site: 'monster' })).ok, false);
});

test('auto mode: candidates are job-site matches above the score with no sent application; the task names the user\'s limits', async () => {
  R.jobsAdd({ site: 'naukri', jobs: [
    { title: 'Senior React Developer', company: 'Zed', url: 'https://www.naukri.com/job-listings-zed-2', description: 'React and Node.js' },
    { title: 'Java Developer', company: 'Old', url: 'https://www.naukri.com/job-listings-old-3', description: 'Java' },
  ] });
  R.jobsScore();
  const c = await runTool('jobs_auto_candidates', { min_score: 40, sites: ['naukri', 'freelancer'], daily_cap: 5 });
  const names = c.data.map((j) => j.company);
  assert.ok(names.includes('Zed'));
  assert.ok(!names.includes('Old'), 'low score left out');
  assert.ok(!names.includes('Blue Co'), 'freelance sites never auto-apply');
  assert.ok(!names.includes('Acme Tech'), 'already further along');
  const zed = c.data.find((j) => j.company === 'Zed');
  R.jobsDraft({ job: zed.id, text: 'Dear Zed team, I would like to apply for the Senior React Developer role. For four years I have built React front ends and Node.js services, most recently a dashboard used by two thousand sales staff every day. I moved our main app to a typed codebase and cut page load time by a third, and I set up the component library my team still uses today. I would be glad to show you that work and talk about how I can help Zed ship faster. Regards, Asha' });
  const t = await runTool('jobs_apply_task', { job: zed.id, auto: { min_score: 80, sites: ['naukri'], daily_cap: 5 } });
  assert.match(t.text, /^USER CONFIRMED: the user switched on automatic applications in the app \(jobs scoring 80\+ on naukri, up to 5 a day\)\. This is one of them: "Senior React Developer at Zed on naukri"/);
});
