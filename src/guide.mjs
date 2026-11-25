// The steps of a search run, given to the agent by jobs_guide, and the browser tasks the app builds.
import { INBOX_URLS as INBOX_URLS_FOR_TASK } from './messages.mjs';

export const JOB_FORMAT = `{
  "title": "Senior React Developer",
  "company": "Acme Tech",            // client name on freelance sites, if shown
  "location": "Bengaluru (Hybrid)",
  "salary": "12-18 Lacs PA",         // or "$25-40/hr", "Fixed: $500"; "" when not shown
  "experience": "4-7 Yrs",
  "posted": "3 days ago",
  "url": "https://www.naukri.com/job-listings-...",   // the job's own page, full link
  "description": "Short text shown with the job (up to 500 characters)",
  "remote": false,
  "skills": ["React", "Redux", "TypeScript"]          // the tags shown, if any
}`;

export function browserTask(search) {
  return [
    `Open ${search.url} in the browser. READ ONLY: do not click Apply, Easy Apply, Submit a proposal, Message or Save, and do not change any setting or filter beyond what is needed to see the list.`,
    'If a sign-in, verification or CAPTCHA page appears, hand it to the user (they sign in themselves) and continue when they are done.',
    'From the results list (the first page, up to 20 jobs), return ONLY a JSON array, one object per job, in this format:',
    JOB_FORMAT,
    'Copy the text as shown on the page; leave a field "" when it is not shown. Never guess a link: use the link of the job\'s own page.',
  ].join('\n');
}

export function guide() {
  return `# Job & Freelance Finder: how a search run works

You read job pages, keep the jobs, score them, show the best ones, and write cover letters and proposals (jobs_draft). You never apply, send or message anyone yourself, and never ask the browser to click Apply, Submit or Send: the user applies with one click in the Jobs tab, and the app does the rest.

## 1. Profile (once)
- jobs_cv_read {path} → the CV text.
- From it, propose the profile: headline, skills (the 6-15 that matter most), years of experience, roles wanted, locations and remote, minimum salary in LPA (jobs) and hourly rate in $ (freelance), words to avoid. Ask the user to confirm or change it (ask_question). Use only what the CV or the user says: never add skills or years.
- jobs_profile_set with the confirmed fields.

## 2. Saved searches
- jobs_search_add {site, query, location} for each site the user wants (naukri, linkedin, indeed, upwork, freelancer; "other" with url). Suggest 1-3 queries from the roles and top skills.

## 3. A search run
For each saved search (or the one the user asked for), one at a time:
1. delegate_to_agent to "browser" with the task from jobs_search_list (field "browser_task"), word for word.
2. Take the JSON array from its answer (if it answered in prose, pull the jobs out yourself; never invent one).
3. jobs_add {site, search, jobs}.
Then jobs_score once, and jobs_digest to show the matches.

## 4. Showing matches
A numbered list, best first: score, title, company, place, pay, why it fits (and what does not), link. Ask which to shortlist (jobs_mark "shortlisted") or dismiss ("dismissed"). For a shortlisted job the user may ask for the full text: have the browser open the job's link (read only) and jobs_add it again with the longer description; it is scored again.

## Job format (what the browser returns)
${JOB_FORMAT}
`;
}

/**
 * The Browser Agent's task for one approved application (built for the app; the agent never gets it).
 * On job sites the user's click in the app is the confirmation to submit THIS application; on
 * freelance sites a proposal costs paid credits, so the form is filled and the user sends it.
 */
export function applyTask(job, profile, auto = null) {
  const submit = !!job.draft?.submit;
  const facts = [
    profile?.name && `Name: ${profile.name}`,
    profile?.years != null && `Years of experience: ${profile.years}`,
    profile?.skills?.length && `Skills: ${profile.skills.join(', ')}`,
    profile?.locations?.length && `Preferred locations: ${profile.locations.join(', ')}${profile.remote ? ' (remote is fine)' : ''}`,
    profile?.cv_path && `CV file to upload when the form asks for one and none is attached: ${profile.cv_path}`,
  ].filter(Boolean);
  const where = `${job.title}${job.company ? ` at ${job.company}` : ''} on ${job.site}`;
  return [
    submit && auto
      ? `USER CONFIRMED: the user switched on automatic applications in the app (jobs scoring ${auto.min_score}+ on ${auto.sites.join(', ')}, up to ${auto.daily_cap} a day). This is one of them: "${where}". Submit only this application, with the text below.`
      : submit
      ? `USER CONFIRMED: the user approved this one application in the app: "${where}". Submit only this application, with the text below.`
      : `The user approved this proposal for "${where}". Fill it in, but do NOT click Send / Submit a proposal: that spends the user's paid credits, so the user sends it.`,
    `Job page: ${job.url}`,
    '',
    '1. Open the job page. If a sign-in, verification or CAPTCHA page appears, hand it to the user and continue when they are done.',
    '2. Click Apply (or Easy Apply, Apply now, I\'m interested, Submit a proposal). If the site sends you to the company\'s own website, stop there.',
    '3. Fill the form ONLY with the facts below and what the site already filled in from the user\'s account (leave those as they are).',
    '4. In the cover letter / message / proposal box, paste the text below EXACTLY, without changing a word. If there is no such box, skip it.',
    '5. If the form asks anything the facts do not answer (current or expected salary, notice period, work permit, rates, screening questions), do not guess and do not pick an answer: stop.',
    submit
      ? '6. When every field is filled, look over the form once, then click the final Submit / Send application button with confirmed: true.'
      : '6. When the proposal is filled in, stop. Do not click Send or Submit.',
    '7. End your answer with exactly ONE line:',
    '   RESULT: SENT                       (the site showed the application was sent)',
    '   RESULT: READY_FOR_YOU <what is left for the user to click>',
    '   RESULT: NEEDS_YOU <the questions or step the user must answer>',
    '   RESULT: FAILED <why>',
    '',
    'Facts about the user:',
    ...facts.map((f) => `- ${f}`),
    '',
    `${job.draft?.kind === 'proposal' ? 'Proposal' : 'Cover letter'} (paste exactly):`,
    '---',
    job.draft?.text || '',
    '---',
  ].join('\n');
}

/** The Browser Agent's read-only task for one site's inbox (built for the app). */
export function inboxTask(site, url) {
  return [
    `Open ${url} in the browser (the ${site} messages / inbox). If it is not the inbox, open Messages from the site's menu. READ ONLY: do not reply, send, accept, decline, archive or mark anything.`,
    'If a sign-in, verification or CAPTCHA page appears, hand it to the user (they sign in themselves) and continue when they are done.',
    'Open each of the 10 most recent conversations (fewer if there are fewer) and return ONLY a JSON array, one object per conversation:',
    `{
  "url": "link of the conversation (copy it from the address bar after opening it)",
  "from": "the other person's name",
  "company": "their company or client name, if shown",
  "job_title": "the job or project it is about, if shown",
  "messages": [ { "from": "name", "mine": false, "text": "the message, word for word", "at": "time as shown" } ]   // the last 6 messages, oldest first; mine: true for the user's own
}`,
    'Copy the text as shown. Leave a field "" when it is not shown. Never invent a message.',
  ].join('\n');
}

/** The Browser Agent's task to send one reply the user approved with a click (built for the app). */
export function replyTask(thread) {
  return [
    `USER CONFIRMED: the user approved this one reply in the app, to ${thread.from || thread.company} on ${thread.site}. Send only this reply, in this conversation.`,
    `Conversation: ${thread.url || `the conversation with ${thread.from}${thread.company ? ` (${thread.company})` : ''} in the ${thread.site} inbox: ${INBOX_URLS_FOR_TASK[thread.site] || ''}`}`,
    '',
    '1. Open the conversation. If a sign-in, verification or CAPTCHA page appears, hand it to the user and continue when they are done.',
    '2. Check it is the right conversation (same person, and their last message is there). If not, stop.',
    '3. Type the reply below EXACTLY, without changing a word, in the message box, then press Send with confirmed: true. Do not attach anything, accept, decline or click anything else.',
    '4. End your answer with exactly ONE line: RESULT: SENT, or RESULT: NEEDS_YOU <why>, or RESULT: FAILED <why>.',
    '',
    'Reply (type exactly):',
    '---',
    thread.reply?.text || '',
    '---',
  ].join('\n');
}
