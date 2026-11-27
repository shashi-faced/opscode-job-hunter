// Messages from recruiters and clients (J3): the threads the browser read from the sites' inboxes,
// linked to the job they are about, with a reply the agent drafted. A reply goes out only when the
// user clicks Send in the Jobs tab (the app records that with jobs_reply_state, which the agent lacks).
import crypto from 'node:crypto';
import { readJson, writeJson, FixError } from './store.mjs';
import { hasTerm } from './score.mjs';

export const REPLY_STATES = ['none', 'waiting', 'sending', 'sent', 'needs_you', 'failed', 'dismissed'];

/** Inbox pages of the sites (the browser finds Messages in the menu if a site moved it). */
export const INBOX_URLS = {
  email: '',
  naukri: 'https://www.naukri.com/mnjuser/inbox',
  linkedin: 'https://www.linkedin.com/messaging/',
  indeed: 'https://messages.indeed.com/conversations',
  freelancer: 'https://www.freelancer.com/messages',
};

/** Words that make a message about money or a commitment: the reply always waits for the user's own reading. */
const SENSITIVE_RE = /\$\s?\d|₹|\b(salary|ctc|lpa|lakhs?|package|rates?|budget|inr|usd|payment|paid|invoice|contract|offer letter|offer|accept|joining|join on|start date|notice period|bond|agreement|nda|sign|milestone|fixed[- ]price|hourly|per hour|\/hr)\b/i;
export const isSensitive = (text) => SENSITIVE_RE.test(String(text || ''));

/**
 * What a message from the other side says about the job, strongest first. Only a hint: the user
 * confirms before the job is marked (an "offer" can be a scam or a misunderstanding).
 */
const SIGNALS = [
  ['hired', /\b(you(?:'|’)ve been hired|you have been hired|hired you|contract (?:has )?started|offer (?:has been )?accepted|welcome (?:to|aboard) the team|we(?:'|’)re (?:pleased|happy|delighted) to (?:offer|hire)|pleased to offer you|offer letter (?:is )?attached)\b/i],
  ['offer', /\b(job offer|an offer|offer letter|we(?:'|’)d like to offer|we would like to offer|extend(?:ing)? an offer|selected for the (?:role|position))\b/i],
  ['interview', /\b(interview|schedule a call|phone screen|technical round|hr round|shortlisted|next round|assessment|meet (?:with )?(?:the )?team|book a (?:time|slot))\b/i],
  ['rejected', /\b(not (?:be )?moving forward|regret to inform|unfortunately[^.]{0,80}(?:not|other candidates)|position has been filled|not selected|decided to go with|declined your (?:proposal|application))\b/i],
];
export function signalOf(text) {
  const t = String(text || '');
  for (const [name, re] of SIGNALS) if (re.test(t)) return name;
  return null;
}

/** Is an e-mail about the job search? (the user's mailbox has everything else too) */
const JOB_MAIL_RE = /\b(application|applied|interview|position|role|opening|vacanc|opportunit|recruit|hiring|hired|resume|cv|candidate|offer|freelance|proposal|contract|job)\b/i;
export const looksLikeJobMail = (t) => JOB_MAIL_RE.test(`${t.job_title || ''} ${(t.messages || []).map((m) => m.text).join(' ')}`);

const str = (v, max = 300) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const load = () => readJson('messages', 'threads', []);
const save = (t) => writeJson('messages', 'threads', t);
const idFor = (key) => crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);

/** Which job a thread is about: same company, and the job title in the thread if it has one. */
function linkJob(thread, jobs) {
  const company = thread.company.toLowerCase();
  const pool = jobs.filter((j) => j.company && company && (j.company.toLowerCase() === company || hasTerm(company, j.company) || hasTerm(j.company, company)));
  if (!pool.length) return null;
  if (thread.job_title) {
    const exact = pool.find((j) => j.title.toLowerCase() === thread.job_title.toLowerCase()) || pool.find((j) => hasTerm(thread.job_title, j.title) || hasTerm(j.title, thread.job_title));
    if (exact) return exact;
  }
  return pool.sort((a, b) => (b.draft?.sentAt ? 1 : 0) - (a.draft?.sentAt ? 1 : 0))[0];
}

/**
 * App only: save the threads the browser read. New messages from the other side mark the thread as
 * needing a reply and the linked job as "replied" (if it was not further along).
 */
export function messagesAdd(p, jobsApi, now = Date.now()) {
  const site = str(p.site, 30).toLowerCase();
  if (!(site in INBOX_URLS)) throw new FixError(`unknown site "${p.site}"`, `use one of: ${Object.keys(INBOX_URLS).join(', ')}`);
  let incoming = p.threads;
  if (typeof incoming === 'string') { try { incoming = JSON.parse(incoming); } catch { throw new FixError('threads is not valid JSON', 'pass "threads" as an array'); } }
  if (!Array.isArray(incoming)) throw new FixError('threads is missing', 'pass "threads": the conversations read from the inbox');
  const threads = load();
  const jobs = jobsApi.load();
  const fresh = [];
  for (const raw of incoming.slice(0, 50)) {
    const url = str(raw?.url || raw?.thread_url, 1000);
    const from = str(raw?.from || raw?.name, 120);
    const email = str(raw?.email || raw?.from_email, 200);
    const company = str(raw?.company, 200);
    const msgs = (Array.isArray(raw?.messages) ? raw.messages : []).map((m) => ({ from: str(m?.from, 120), mine: m?.mine === true || m?.mine === 'true', text: str(m?.text, 3000), at: str(m?.at, 60) })).filter((m) => m.text).slice(-12);
    if (!from && !company) continue;
    if (!msgs.length) continue;
    const key = url || `${site}|${from}|${company}`;
    const id = idFor(key);
    let t = threads.find((x) => x.id === id);
    if (!t) {
      t = { id, site, url, from, company, job_title: str(raw?.job_title, 200), job: null, messages: [], reply: { state: 'none' }, updatedAt: null };
      if (site === 'email') {
        // Only mail about the job search is kept: from a company the user found jobs at, or about applying.
        const known = linkJob(t, jobs);
        if (!known && !looksLikeJobMail({ job_title: t.job_title, messages: msgs })) continue;
        Object.assign(t, { email, gmail_thread: str(raw?.thread_id, 100), message_id: str(raw?.message_id, 300), subject: str(raw?.job_title || raw?.subject, 300) });
      }
      threads.push(t);
    }
    if (site === 'email' && raw?.message_id) t.message_id = str(raw.message_id, 300);
    const known = new Set(t.messages.map((m) => `${m.mine}|${m.text}`));
    const added = msgs.filter((m) => !known.has(`${m.mine}|${m.text}`));
    if (!added.length) continue;
    t.messages = [...t.messages, ...added].slice(-20);
    t.updatedAt = new Date(now).toISOString();
    const last = t.messages[t.messages.length - 1];
    if (!t.job) { const j = linkJob(t, jobs); if (j) t.job = j.id; }
    if (!last.mine) {
      t.needsReply = true;
      t.sensitive = isSensitive(t.messages.filter((m) => !m.mine).slice(-3).map((m) => m.text).join(' '));
      const sig = signalOf(added.filter((m) => !m.mine).map((m) => m.text).join(' '));
      if (sig) { t.signal = sig; t.signalAt = new Date(now).toISOString(); }
      if (!['waiting', 'sending'].includes(t.reply.state)) t.reply = { state: 'none' };
      fresh.push(t);
      if (t.job) jobsApi.markReplied(t.job, `${from || company} wrote on ${site}`);
    } else t.needsReply = false;
  }
  save(threads);
  return { fresh, total: threads.length };
}

export function inbox(p = {}) {
  let t = load();
  if (!p.all) t = t.filter((x) => x.needsReply || ['waiting', 'needs_you', 'failed'].includes(x.reply.state));
  return t.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Number(p.limit) || 30);
}

export function getThread(id) {
  const t = load().find((x) => x.id === id);
  if (!t) throw new FixError(`no conversation "${id}"`, 'use an id from jobs_inbox');
  return t;
}

/** Check a reply. byUser: the user's own edit, only the hard limits. */
export function checkReply(text, thread, byUser = false) {
  const errors = [];
  const t = String(text || '').trim();
  if (!t) errors.push({ error: 'the reply is empty', fix: 'write the reply' });
  if (t.length > 2000) errors.push({ error: `${t.length} characters`, fix: 'keep a reply under 2000 characters' });
  const ph = /\[[^\]\n]{2,40}\]|\{\{?[^}\n]{1,40}\}?\}|\b(TODO|TBD|XXX)\b/i.exec(t);
  if (ph) errors.push({ error: `"${ph[0]}" is a placeholder`, fix: 'fill it in or remove it' });
  if (['freelancer', 'guru', 'peopleperhour'].includes(thread.site)) {
    const c = /[\w.+-]+@[\w-]+\.[\w.]+|(?:\+?\d[\s-]?){10,}|\b(whatsapp|telegram|skype)\b/i.exec(t);
    if (c) errors.push({ error: `"${c[0]}" is contact information`, fix: `remove it: ${thread.site} does not allow contact details before a contract` });
  }
  if (!byUser && /\b(i accept|i agree|accepted|deal|confirmed?|i('|’)ll (join|start|sign)|see you on)\b/i.test(t)) {
    errors.push({ error: 'it accepts or agrees to something', fix: 'do not accept, agree or commit for the user: thank them, answer what you can from the profile, and say the user will confirm the details personally' });
  }
  return { ok: errors.length === 0, errors, sensitive: isSensitive(t) || !!thread.sensitive };
}

export function replyDraft(p, now = Date.now()) {
  const threads = load();
  const t = threads.find((x) => x.id === String(p.thread || ''));
  if (!t) throw new FixError(`no conversation "${p.thread}"`, 'use an id from jobs_inbox');
  if (['sending', 'sent'].includes(t.reply.state) && !t.needsReply) throw new FixError('the reply is already sent', 'wait for their next message');
  const byUser = p.by_user === true || p.by_user === 'true';
  const c = checkReply(p.text, t, byUser);
  if (!c.ok) return { ok: false, thread: t, check: c };
  t.reply = { state: 'waiting', text: String(p.text).trim(), sensitive: c.sensitive, byUser, updatedAt: new Date(now).toISOString(), note: '' };
  save(threads);
  return { ok: true, thread: t, check: c };
}

/** App only: what happened to a reply (sent clears "needs a reply"). */
export function replyState(p, now = Date.now()) {
  if (!REPLY_STATES.includes(p.state)) throw new FixError(`unknown state "${p.state}"`, `use one of: ${REPLY_STATES.join(', ')}`);
  const threads = load();
  const t = threads.find((x) => x.id === String(p.thread || ''));
  if (!t) throw new FixError(`no conversation "${p.thread}"`, 'use an id from jobs_inbox');
  t.reply = { ...t.reply, state: p.state, note: str(p.note, 800), updatedAt: new Date(now).toISOString() };
  if (p.state === 'sent') {
    t.needsReply = false;
    if (t.reply.text) t.messages = [...t.messages, { from: 'you', mine: true, text: t.reply.text, at: new Date(now).toISOString() }].slice(-20);
  }
  if (p.state === 'dismissed') t.needsReply = false;
  save(threads);
  return t;
}
