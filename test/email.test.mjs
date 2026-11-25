import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.OPSCODE_JOBS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-mail-'));
const R = await import('../src/records.mjs');
const M = await import('../src/messages.mjs');
const { runTool } = await import('../src/tools.mjs');

R.profileSet({ name: 'Asha K', skills: ['React', 'Node.js'], years: 4, cv_path: '/home/asha/cv.pdf' });
const LETTER = 'Dear Hiring team, I would like to apply for the React Developer role. For four years I have built React front ends and Node.js services, most recently a dashboard used by two thousand sales staff every day. I moved our main app to a typed codebase and cut page load time by a third, and I set up the component library my team still uses today. I would be glad to show you that work and talk about how I can help you ship faster. Regards, Asha K';

test('what a message says: hired, offer, interview, rejected (strongest first), or nothing', () => {
  assert.equal(M.signalOf("Congratulations! You've been hired for the React dashboard."), 'hired');
  assert.equal(M.signalOf('We would like to offer you the position. The offer letter follows.'), 'offer');
  assert.equal(M.signalOf('Can we schedule a call for a technical round on Friday?'), 'interview');
  assert.equal(M.signalOf('Unfortunately we have decided to go with other candidates.'), 'rejected');
  assert.equal(M.signalOf('Thanks for your message.'), null);
});

test('a post that says "send your CV to" is applied to by e-mail on Apply, with the CV attached', async () => {
  R.jobsAdd({ site: 'other', jobs: [{ title: 'React Developer', company: 'Nova', url: 'https://nova.example/careers/1', description: 'Send your CV to hr@nova.example', apply_email: 'HR@nova.example' }] });
  const j = R.jobsList({ all: true })[0];
  assert.equal(j.apply_email, 'hr@nova.example');
  assert.equal(R.jobsDraft({ job: j.id, text: LETTER }).ok, true);
  assert.equal(R.getJob(j.id).draft.submit, true);
  const t = await runTool('jobs_apply_task', { job: j.id });
  assert.deepEqual(t.data.email, { to: 'hr@nova.example', subject: 'Application: React Developer — Asha K', body: LETTER, attachment: '/home/asha/cv.pdf' });
  R.jobsAdd({ site: 'other', jobs: [{ title: 'Bad', company: 'X', url: 'https://x.example/1', apply_email: 'not an address' }] });
  assert.equal(R.jobsList({ all: true }).find((x) => x.company === 'X').apply_email, undefined);
});

test('from the mailbox only job mail is kept; a reply goes back in the same e-mail thread', async () => {
  const r = await runTool('jobs_messages_add', { site: 'email', threads: [
    { from: 'Ravi (Nova HR)', email: 'ravi@nova.example', company: 'Nova', job_title: 'Re: Application: React Developer', thread_id: 'th1', message_id: '<m1@nova>', messages: [{ from: 'Ravi', text: 'Thanks Asha, we would like to schedule an interview on Monday.' }] },
    { from: 'Shop', email: 'deals@shop.example', company: 'Shop', job_title: 'Big sale this weekend', thread_id: 'th2', messages: [{ from: 'Shop', text: 'Fifty percent off shoes.' }] },
  ] });
  assert.equal(r.data.fresh.length, 1, 'the shop mail is not kept');
  const t = M.inbox().find((x) => x.site === 'email');
  assert.equal(t.signal, 'interview');
  assert.equal(R.jobsList({ all: true }).find((x) => x.company === 'Nova').status, 'replied');
  assert.equal((await runTool('jobs_reply_draft', { thread: t.id, text: 'Hi Ravi, thank you. Monday works for me; could you share the time and who I will meet? Asha' })).ok, true);
  const task = await runTool('jobs_reply_task', { thread: t.id });
  assert.deepEqual(task.data.email, { to: 'ravi@nova.example', subject: 'Re: Application: React Developer', body: 'Hi Ravi, thank you. Monday works for me; could you share the time and who I will meet? Asha', thread_id: 'th1', in_reply_to: '<m1@nova>' });
});

test('the portal gets counts and the latest steps only; won jobs are listed for the one-time notification', async () => {
  const nova = R.jobsList({ all: true }).find((x) => x.company === 'Nova');
  R.jobsMark({ job: nova.id, status: 'won', note: 'offer accepted by the user' });
  const p = await runTool('jobs_pipeline', {});
  assert.equal(p.data.counts.won, 1);
  assert.deepEqual(Object.keys(p.data.recent[0]).sort(), ['at', 'company', 'site', 'status', 'title']);
  assert.equal(p.data.recent[0].status, 'won');
  assert.doesNotMatch(JSON.stringify(p.data), /Dear Hiring|hr@nova|cv\.pdf/);
  assert.deepEqual((await runTool('jobs_won', {})).data.map((j) => j.company), ['Nova']);
});
