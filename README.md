# Opscode Job & Freelance Finder

An Opscode agent that finds jobs and freelance gigs that fit your CV:

1. builds your profile from the CV (skills, years, roles, places, pay); you confirm it, and nothing is added that the CV does not say;
2. keeps saved searches on Naukri, LinkedIn, Indeed, Upwork and Freelancer;
3. has the app's **Browser Agent** read the results in your own signed-in browser (read only);
4. keeps each job once and scores it 0-100 against the profile, with the reasons (skills, role, place, pay, experience asked, words you avoid, age of the post);
5. tracks each job: found → shortlisted / dismissed → applied → replied → interview → offer → won / lost.

This version (0.1.0) never applies, sends proposals or messages. Drafting and applying come next (see the app's `docs/plans/job-hunter/PLAN.md`).

## CLI

```
opscode-jobs doctor                   Node.js, pdftotext, data folder
opscode-jobs guide                    steps of a search run, job format
opscode-jobs status                   profile, searches, counts
opscode-jobs digest                   matches of the last 24 hours
opscode-jobs tool <name> '<json>'     run a tool (the app uses --b64)
opscode-jobs tools | agent-manifest
```

## Tools

| Tool | What it does |
|---|---|
| `jobs_cv_read` | Text of a CV: .pdf (pdftotext), .docx, .txt, .md |
| `jobs_profile_set` / `_get` | Skills, years, roles, locations, remote, minimum salary (LPA), hourly rate ($), words to avoid |
| `jobs_search_add` / `_list` / `_remove` | Saved searches; the results link is built for known sites; each comes with the read-only task for the Browser Agent |
| `jobs_add` | Jobs read from a page; repeats (same link without tracking parts, or same title + company) skipped |
| `jobs_score` | 0-100 with reasons, in code |
| `jobs_list` / `jobs_get` / `jobs_mark` / `jobs_digest` / `jobs_status` | Matches, one job, status changes with notes, the day's best, overview |

Data: `~/.opscode/job-hunter` (or `$OPSCODE_JOBS_HOME`). No passwords or site cookies are stored.

## Tests

```
npm test
```
