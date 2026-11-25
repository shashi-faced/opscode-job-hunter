// Tools the Opscode app calls: `opscode-jobs tool <name> --b64 <params>` → { ok, text, data }.
import { FixError } from './store.mjs';
import {
  STATUSES, SITES, cvRead, profileGet, profileSet, searchAdd, searchList, searchRemove,
  jobsAdd, jobsScore, jobsList, jobsMark, jobsDigest, jobsStatus, getJob,
  jobsDraft, jobsDrafts, jobsDraftState, DRAFT_STATES, profileGet as profileOf, jobsApi, autoCandidates,
} from './records.mjs';
import { guide, browserTask, applyTask, inboxTask, replyTask } from './guide.mjs';
import { INBOX_URLS, messagesAdd, inbox, getThread, replyDraft, replyState, REPLY_STATES } from './messages.mjs';
import { LIMITS } from './draft.mjs';

const S = { type: 'string' };
const A = { type: 'array', items: S };
const siteEnum = { type: 'string', enum: Object.keys(SITES) };
const jobParam = { job: { description: 'job id (from jobs_list / jobs_digest), or a list of ids' } };

export const TOOL_DEFS = [
  { name: 'jobs_guide', description: 'How a search run works, step by step, and the job format the browser returns. Call once per chat before the first search.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'jobs_cv_read', description: 'Read the text of the user\'s CV (.pdf, .docx, .txt, .md) to build the profile.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'CV file path, e.g. ~/Documents/cv.pdf' } }, required: ['path'] } },
  { name: 'jobs_profile_set', description: 'Save the profile the user confirmed (only the fields given change). Every job is scored again after a change.', parameters: { type: 'object', properties: {
    name: S, headline: { type: 'string', description: 'one line, e.g. "Full-stack developer, 4 years, React + Node"' },
    skills: { ...A, description: 'the 6-15 main skills from the CV' }, years: { type: 'number', description: 'years of experience' },
    roles: { ...A, description: 'roles wanted, e.g. ["frontend developer", "react developer"]' },
    locations: { ...A, description: 'cities wanted, e.g. ["bengaluru", "pune"]' }, remote: { type: 'boolean', description: 'remote jobs are fine' },
    min_salary_lpa: { type: 'number', description: 'lowest yearly pay for jobs, in lakhs' }, rate_hourly: { type: 'number', description: 'lowest hourly rate for freelance, in $' },
    avoid: { ...A, description: 'words that rule a job out, e.g. ["php", "night shift", "unpaid"]' },
    cv_path: S, notes: { type: 'string', description: 'anything else the user wants or does not want' },
  }, required: [] } },
  { name: 'jobs_profile_get', description: 'The saved profile.', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'jobs_search_add', description: 'Save a search: a site and what to look for. The results link is built for known sites.', parameters: { type: 'object', properties: { site: siteEnum, query: { type: 'string', description: 'what to search, e.g. "react developer"' }, location: { type: 'string', description: 'city, or "remote" (job sites only)' }, kind: { type: 'string', enum: ['job', 'freelance'] }, url: { type: 'string', description: 'results page link; needed for site "other"' } }, required: ['site'] } },
  { name: 'jobs_search_list', description: 'Saved searches, each with the exact task to hand the Browser Agent (browser_task).', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'jobs_search_remove', description: 'Remove a saved search.', parameters: { type: 'object', properties: { search: { type: 'string', description: 'search id' } }, required: ['search'] } },
  { name: 'jobs_add', description: 'Save the jobs the browser read from a results or job page. Repeats are skipped; a longer description updates the job.', parameters: { type: 'object', properties: { site: siteEnum, search: { type: 'string', description: 'saved search id this came from' }, jobs: { type: 'array', items: { type: 'object' }, description: 'jobs in the format from jobs_guide' } }, required: ['site', 'jobs'] } },
  { name: 'jobs_score', description: 'Score jobs 0-100 against the profile, with the reasons (new ones, or all with rescore).', parameters: { type: 'object', properties: { rescore: { type: 'boolean' } }, required: [] } },
  { name: 'jobs_list', description: 'Jobs, best match first (dismissed and lost left out unless status or all is given).', parameters: { type: 'object', properties: { status: { type: 'string', enum: STATUSES }, min_score: { type: 'number' }, site: siteEnum, kind: { type: 'string', enum: ['job', 'freelance'] }, all: { type: 'boolean' }, limit: { type: 'number' } }, required: [] } },
  { name: 'jobs_get', description: 'One job with its full text, score, reasons and history.', parameters: { type: 'object', properties: { job: S }, required: ['job'] } },
  { name: 'jobs_mark', description: `Record where a job stands, as the user said: ${STATUSES.join(', ')}.`, parameters: { type: 'object', properties: { ...jobParam, status: { type: 'string', enum: STATUSES }, note: S }, required: ['job', 'status'] } },
  { name: 'jobs_digest', description: 'The new matches of the last hours (default 24), best first.', parameters: { type: 'object', properties: { hours: { type: 'number' }, min_score: { type: 'number', description: 'default 60' }, limit: { type: 'number' } }, required: [] } },
  { name: 'jobs_draft', description: `Keep a cover letter (job sites) or proposal (freelance sites) for one job. It is checked: ${LIMITS.cover_letter.min}-${LIMITS.cover_letter.max} words for a cover letter, ${LIMITS.proposal.min}-${LIMITS.proposal.max} for a proposal; no skill or years the profile does not have; no placeholders; no contact details in proposals. It then waits for the user's OK in the Jobs tab: you cannot send it.`, parameters: { type: 'object', properties: { job: { type: 'string', description: 'job id' }, text: { type: 'string', description: 'the full text, ready to send' }, kind: { type: 'string', enum: ['cover_letter', 'proposal'], description: 'default: proposal for freelance, cover letter for jobs' } }, required: ['job', 'text'] } },
  { name: 'jobs_drafts', description: 'Applications waiting for the user (or by state), with their text and what happened.', parameters: { type: 'object', properties: { state: { type: 'string', enum: DRAFT_STATES } }, required: [] } },
  { name: 'jobs_inbox', description: 'Conversations with recruiters and clients that need a reply (or all), with their last messages and the job they are about.', parameters: { type: 'object', properties: { all: { type: 'boolean' } }, required: [] } },
  { name: 'jobs_reply_draft', description: 'Keep a reply to one conversation. It waits for the user\'s Send in the Jobs tab: you cannot send it. Never accept, agree or commit for the user (rates, salary, start dates, contracts, interviews times are the user\'s to confirm); answer from the profile only. No contact details on Upwork or Freelancer.', parameters: { type: 'object', properties: { thread: { type: 'string', description: 'conversation id from jobs_inbox' }, text: { type: 'string', description: 'the reply, ready to send' } }, required: ['thread', 'text'] } },
  { name: 'jobs_status', description: 'Overview: profile, saved searches with their last run, counts per status, warnings.', parameters: { type: 'object', properties: {}, required: [] } },
];

const where = (j) => [j.company, j.location, j.salary].filter(Boolean).join(' · ');
const line = (j, i) => `${i != null ? `${i + 1}. ` : ''}[${j.score ?? '–'}] ${j.title}${where(j) ? ` — ${where(j)}` : ''} (${j.site}, ${j.status}, id ${j.id})${j.reasons ? `\n   ${j.reasons}` : ''}${j.url ? `\n   ${j.url}` : ''}`;

const draftLine = (j) => `- ${j.title}${j.company ? ` — ${j.company}` : ''} (${j.site}, id ${j.id}): ${j.draft.kind.replace('_', ' ')}, ${j.draft.words} words, ${j.draft.state.replace('_', ' ')}${j.draft.note ? ` — ${j.draft.note}` : ''}`;

/** Tools only the app calls (not in TOOL_DEFS, so the agent never has them): the user's decision and the browser's result. */
export const APP_TOOLS = ['jobs_draft_state', 'jobs_apply_task', 'jobs_inbox_task', 'jobs_messages_add', 'jobs_reply_state', 'jobs_reply_task', 'jobs_auto_candidates'];
const threadLine = (t) => `- ${t.from || t.company}${t.company && t.from ? ` (${t.company})` : ''} on ${t.site}, id ${t.id}${t.job ? `, job ${t.job}` : ''}${t.sensitive ? ' ⚠ money or commitment' : ''}: "${(t.messages.filter((m) => !m.mine).at(-1)?.text || '').slice(0, 200)}"${t.reply?.state && t.reply.state !== 'none' ? ` — reply ${t.reply.state.replace('_', ' ')}` : ''}`;

const RUN = {
  jobs_guide: () => ({ text: guide() }),
  jobs_cv_read: (p, ctx) => { const r = cvRead(p, ctx.cwd); return { text: `CV ${r.file} (${r.chars} characters):\n\n${r.text}`, data: { file: r.file, chars: r.chars } }; },
  jobs_profile_set: (p) => { const r = profileSet(p); return { text: `Saved the profile: ${r.headline || r.name || ''} — ${r.skills.length} skills${r.years != null ? `, ${r.years} yrs` : ''}${r.locations?.length ? `, ${r.locations.join('/')}` : ''}${r.remote ? ', remote ok' : ''}. Jobs are scored again on the next jobs_score.`, data: r }; },
  jobs_profile_get: () => { const r = profileGet(); return { text: r ? JSON.stringify(r, null, 2) : 'No profile yet. Read the CV with jobs_cv_read.', data: r }; },
  jobs_search_add: (p) => { const r = searchAdd(p); return { text: `${r.existed ? 'Updated' : 'Saved'} search ${r.search.id}: ${SITES[r.search.site].name} ${r.search.kind}, "${r.search.query}"${r.search.location ? ` in ${r.search.location}` : ''}\n${r.search.url}`, data: r.search }; },
  jobs_search_list: () => {
    const l = searchList().map((s) => ({ ...s, browser_task: browserTask(s) }));
    return { text: l.length ? l.map((s) => `- ${s.id}: ${SITES[s.site].name}, "${s.query}"${s.location ? ` in ${s.location}` : ''} (last run ${s.lastRunAt || 'never'})`).join('\n') + '\nEach has browser_task in data: hand it to the Browser Agent word for word.' : 'No saved searches yet. Add one with jobs_search_add.', data: l };
  },
  jobs_search_remove: (p) => { const r = searchRemove(p); return { text: `Removed search ${r.removed}.`, data: r }; },
  jobs_add: (p) => {
    const r = jobsAdd(p);
    const t = [`Added ${r.added.length} new job(s), updated ${r.updated.length}, skipped ${r.repeats.length} already known.`];
    if (r.invalid.length) t.push(`Skipped ${r.invalid.length} without a title or a link/company.`);
    if (r.added.length || r.updated.length) t.push('Next: jobs_score.');
    return { text: t.join(' '), data: r };
  },
  jobs_score: (p) => { const r = jobsScore(p); const top = [...r.jobs].filter((j) => j.status === 'found').sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3); return { text: `Scored ${r.scored} job(s).${top.length ? ` Best now: ${top.map((j) => `${j.score} ${j.title}`).join('; ')}.` : ''} Show them with jobs_digest.`, data: { scored: r.scored } }; },
  jobs_list: (p) => { const l = jobsList(p); return { text: l.length ? l.map((j, i) => line(j, i)).join('\n') : 'No jobs match.', data: l }; },
  jobs_get: (p) => { const j = getJob(p.job); return { text: `${line(j)}\nFound ${j.foundAt}${j.posted ? `, posted ${j.posted}` : ''}${j.experience ? `, ${j.experience}` : ''}\n\n${j.description || '(no description yet: open the link with the browser, read only, and jobs_add it again)'}`, data: j }; },
  jobs_mark: (p) => { const l = jobsMark(p); return { text: l.map((j) => `${j.title} (${j.id}) is now ${j.status}.`).join('\n'), data: l }; },
  jobs_digest: (p) => {
    const r = jobsDigest(p);
    const head = `${r.found} job(s) found in the last ${r.hours} h; ${r.matches.length + r.more} match ${r.min_score}+${r.unscored ? ` (${r.unscored} not scored yet: call jobs_score)` : ''}.`;
    return { text: r.matches.length ? `${head}\n${r.matches.map((j, i) => line(j, i)).join('\n')}${r.more ? `\n…and ${r.more} more (jobs_list)` : ''}` : head, data: r };
  },
  jobs_draft: (p) => {
    const r = jobsDraft(p);
    if (!r.ok) return { ok: false, text: [`Not kept: ${r.check.errors.length} problem(s):`, ...r.check.errors.map((e) => `- ${e.error}. Fix: ${e.fix}`)].join('\n'), data: { errors: r.check.errors, warnings: r.check.warnings } };
    const d = r.job.draft;
    return { text: `Kept the ${d.kind.replace('_', ' ')} for "${r.job.title}" (${d.words} words).${d.warnings.length ? ` Note: ${d.warnings.join('; ')}.` : ''} It waits for the user in the Jobs tab: ${d.submit ? 'one click there applies' : 'one click there fills in the proposal; the user sends it, as it costs their credits'}.`, data: { job: r.job.id, draft: d } };
  },
  jobs_drafts: (p) => { const l = jobsDrafts(p); return { text: l.length ? l.map(draftLine).join('\n') : 'No applications waiting.', data: l }; },
  jobs_draft_state: (p) => { const j = jobsDraftState(p); return { text: `${j.title}: ${j.draft.state.replace('_', ' ')}${j.status === 'applied' ? ' (marked applied)' : ''}.`, data: j }; },
  jobs_apply_task: (p) => {
    const j = getJob(p.job);
    if (!j.draft?.text) throw new FixError('the job has no draft', 'write one with jobs_draft first');
    if (!j.url) throw new FixError('the job has no link', 'add the job again with its link');
    const auto = p.auto && typeof p.auto === 'object' ? { min_score: Number(p.auto.min_score), sites: [].concat(p.auto.sites || []), daily_cap: Number(p.auto.daily_cap) } : null;
    return { text: applyTask(j, profileOf(), auto), data: { job: j.id, submit: !!j.draft.submit, url: j.url, site: j.site, title: j.title, company: j.company } };
  },
  jobs_inbox: (p) => { const l = inbox(p); return { text: l.length ? l.map(threadLine).join('\n') : 'No conversations need a reply.', data: l }; },
  jobs_reply_draft: (p) => {
    const r = replyDraft(p);
    if (!r.ok) return { ok: false, text: [`Not kept: ${r.check.errors.length} problem(s):`, ...r.check.errors.map((e) => `- ${e.error}. Fix: ${e.fix}`)].join('\n'), data: { errors: r.check.errors } };
    return { text: `Kept the reply to ${r.thread.from || r.thread.company}.${r.check.sensitive ? ' It is about money or a commitment: the user reads it before sending.' : ''} It waits for the user's Send in the Jobs tab.`, data: { thread: r.thread.id, reply: r.thread.reply } };
  },
  jobs_inbox_task: (p) => {
    const site = String(p.site || '');
    if (!INBOX_URLS[site]) throw new FixError(`no inbox for "${site}"`, `use one of: ${Object.keys(INBOX_URLS).join(', ')}`);
    return { text: inboxTask(site, INBOX_URLS[site]), data: { site, url: INBOX_URLS[site] } };
  },
  jobs_messages_add: (p) => { const r = messagesAdd(p, jobsApi); return { text: `${r.fresh.length} conversation(s) with new messages.`, data: { fresh: r.fresh.map((t) => ({ id: t.id, from: t.from, company: t.company, site: t.site, job: t.job, sensitive: !!t.sensitive })), total: r.total } }; },
  jobs_reply_state: (p) => { const t = replyState(p); return { text: `Reply to ${t.from || t.company}: ${t.reply.state.replace('_', ' ')}.`, data: t }; },
  jobs_reply_task: (p) => {
    const t = getThread(p.thread);
    if (!t.reply?.text) throw new FixError('the conversation has no reply', 'write one with jobs_reply_draft first');
    return { text: replyTask(t), data: { thread: t.id, site: t.site, from: t.from, company: t.company, sensitive: !!t.reply.sensitive } };
  },
  jobs_auto_candidates: (p) => { const l = autoCandidates(p); return { text: l.map((j) => `${j.score} ${j.title} (${j.id})`).join('\n') || 'None.', data: l }; },
  jobs_status: () => {
    const r = jobsStatus();
    const t = [
      r.profile ? `Profile: ${r.profile.headline || r.profile.name || 'saved'} (${r.profile.skills} skills)` : 'Profile: none',
      `Searches: ${r.searches.length ? r.searches.map((s) => `${s.site} "${s.query}" (last ${s.lastRunAt || 'never'})`).join('; ') : 'none'}`,
      `Jobs: ${r.total} — ${Object.entries(r.counts).filter(([, n]) => n).map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}; strong matches waiting: ${r.strong}`,
      ...r.warnings.map((w) => `⚠ ${w}`),
    ];
    return { text: t.join('\n'), data: r };
  },
};

export async function runTool(name, params = {}, ctx = {}) {
  const fn = RUN[name];
  if (!fn) return { ok: false, text: `Unknown tool "${name}". Tools: ${Object.keys(RUN).join(', ')}` };
  try {
    const r = await fn(params || {}, { cwd: ctx.cwd || process.cwd() });
    return { ok: r.ok ?? true, text: r.text, data: r.data };
  } catch (e) {
    if (!(e instanceof FixError) && !e.fix) return { ok: false, text: `${e.message}.`, data: { error: e.message } };
    return { ok: false, text: `${e.message}. Fix: ${e.fix}`, data: { error: e.message, fix: e.fix, details: e.details } };
  }
}
