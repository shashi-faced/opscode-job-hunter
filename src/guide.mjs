// The steps of a search run, given to the agent by jobs_guide.

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

Nothing is ever sent in this version: you read job pages, keep the jobs, score them and show the best ones. You do not apply, send proposals or messages, or e-mail anyone. If the user asks for that, say it comes in the next version and offer the job link so they can apply themselves (then record it with jobs_mark "applied").

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
