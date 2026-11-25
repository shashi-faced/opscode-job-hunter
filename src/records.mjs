// Job & Freelance Finder's records: the profile, saved searches and every job found (once), with its score and status.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readJson, writeJson, removeJson, listIds, FixError } from './store.mjs';
import { scoreJob } from './score.mjs';
import { checkDraft } from './draft.mjs';

export const STATUSES = ['found', 'shortlisted', 'dismissed', 'applied', 'replied', 'interview', 'offer', 'won', 'lost'];
export const SITES = {
  naukri: { name: 'Naukri', kind: 'job' },
  linkedin: { name: 'LinkedIn', kind: 'job' },
  indeed: { name: 'Indeed', kind: 'job' },
  upwork: { name: 'Upwork', kind: 'freelance' },
  freelancer: { name: 'Freelancer', kind: 'freelance' },
  other: { name: 'Other site', kind: 'job' },
};
const MAX_DESC = 4000;
const str = (v, max = 300) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const list = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/)).map((x) => str(x, 80)).filter(Boolean);
const slug = (s) => str(s, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ───────────────────────── CV and profile ─────────────────────────

/** Text of a CV: .pdf (pdftotext), .docx (its document.xml), .txt / .md. */
export function cvRead({ path: p }, cwd = process.cwd()) {
  if (!p) throw new FixError('path is missing', 'pass "path": the CV file, e.g. ~/Documents/cv.pdf');
  const file = path.resolve(cwd, String(p).replace(/^~(?=\/|$)/, process.env.HOME || '~'));
  if (!fs.existsSync(file)) throw new FixError(`${file} does not exist`, 'ask the user for the exact path of their CV (list_directory can help find it)');
  const ext = path.extname(file).toLowerCase();
  let text;
  try {
    if (ext === '.pdf') text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 20 << 20 });
    else if (ext === '.docx') {
      const xml = execFileSync('unzip', ['-p', file, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 20 << 20 });
      text = xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    } else if (['.txt', '.md', '.text', ''].includes(ext)) text = fs.readFileSync(file, 'utf8');
    else throw new FixError(`${ext} files are not read`, 'ask the user for the CV as PDF, Word (.docx) or text');
  } catch (e) {
    if (e instanceof FixError) throw e;
    if (e.code === 'ENOENT') throw new FixError(`${ext === '.pdf' ? 'pdftotext' : 'unzip'} is not installed`, ext === '.pdf' ? 'install poppler-utils (sudo apt install poppler-utils), or ask the user for the CV as .docx or text' : 'install unzip, or ask the user for the CV as PDF or text');
    throw new FixError(`could not read ${file}: ${e.message}`, 'ask the user for another copy of the CV (PDF, .docx or text)');
  }
  text = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 50) throw new FixError('the CV has almost no text (a scanned image?)', 'ask the user for a text-based PDF or .docx, or for their skills and experience in the chat');
  return { file, text: text.slice(0, 30_000), chars: text.length };
}

export function profileGet() { return readJson('profile', 'me', null); }

export function profileSet(p) {
  const prev = profileGet() || {};
  const next = { ...prev };
  for (const k of ['name', 'headline', 'notes', 'cv_path', 'currency']) if (p[k] != null) next[k] = str(p[k], k === 'notes' ? 2000 : 300);
  for (const k of ['skills', 'roles', 'locations', 'avoid']) if (p[k] != null) next[k] = [...new Set(list(p[k]))].slice(0, 60);
  for (const k of ['years', 'min_salary_lpa', 'rate_hourly']) if (p[k] != null && p[k] !== '') {
    const n = Number(p[k]);
    if (!Number.isFinite(n) || n < 0) throw new FixError(`${k} must be a number`, `pass ${k} as a number, e.g. ${k === 'years' ? 4 : k === 'rate_hourly' ? 25 : 12}`);
    next[k] = n;
  }
  if (p.remote != null) next.remote = p.remote === true || p.remote === 'true';
  if (!next.skills?.length) throw new FixError('the profile has no skills', 'pass "skills": the main skills from the CV, e.g. ["React", "Node.js", "TypeScript"]');
  next.updatedAt = new Date().toISOString();
  writeJson('profile', 'me', next);
  // A changed profile changes the scores: score every job again with jobs_score.
  const jobs = loadJobs();
  for (const j of jobs) j.score = null;
  saveJobs(jobs);
  return next;
}

const needProfile = () => {
  const p = profileGet();
  if (!p) throw new FixError('there is no profile yet', 'read the CV with jobs_cv_read, confirm the skills and wishes with the user, then call jobs_profile_set');
  return p;
};

// ───────────────────────── saved searches ─────────────────────────

/** The results page of a search on a known site (newest first where the site allows it). */
export function searchUrl({ site, query, location }) {
  const q = encodeURIComponent(str(query));
  const l = encodeURIComponent(str(location));
  switch (site) {
    case 'naukri': return `https://www.naukri.com/${slug(query)}-jobs${location && !/remote/i.test(location) ? `-in-${slug(location)}` : ''}${/remote/i.test(location || '') ? '?wfhType=2' : ''}`;
    case 'linkedin': return `https://www.linkedin.com/jobs/search/?keywords=${q}${location ? `&location=${l}` : ''}&sortBy=DD`;
    case 'indeed': return `https://in.indeed.com/jobs?q=${q}${location ? `&l=${l}` : ''}&sort=date`;
    case 'upwork': return `https://www.upwork.com/nx/search/jobs/?q=${q}&sort=recency`;
    case 'freelancer': return `https://www.freelancer.com/search/projects?q=${q}`;
    default: return null;
  }
}

export function searchAdd(p) {
  const site = str(p.site, 30).toLowerCase();
  if (!SITES[site]) throw new FixError(`unknown site "${p.site}"`, `use one of: ${Object.keys(SITES).join(', ')} (other needs url)`);
  if (!str(p.query) && !p.url) throw new FixError('query is missing', 'pass "query": what to search, e.g. "react developer"');
  const url = p.url ? str(p.url, 1000) : searchUrl({ site, query: p.query, location: p.location });
  if (!url) throw new FixError('url is missing', 'for site "other" pass "url": the results page to read');
  if (!/^https:\/\//.test(url)) throw new FixError('url must start with https://', 'pass the full https:// link of the results page');
  const id = slug(`${site} ${p.query || ''} ${p.location || ''}`).slice(0, 60) || `search-${Date.now()}`;
  const s = { id, site, kind: p.kind === 'freelance' || p.kind === 'job' ? p.kind : SITES[site].kind, query: str(p.query), location: str(p.location), url, createdAt: new Date().toISOString(), lastRunAt: null };
  const prev = readJson('searches', id, null);
  writeJson('searches', id, prev ? { ...prev, ...s, createdAt: prev.createdAt, lastRunAt: prev.lastRunAt } : s);
  return { search: readJson('searches', id), existed: !!prev };
}
export const searchList = () => listIds('searches').map((id) => readJson('searches', id)).filter(Boolean);
export function searchRemove({ search }) {
  if (!readJson('searches', search, null)) throw new FixError(`no saved search "${search}"`, 'use an id from jobs_search_list');
  removeJson('searches', search);
  return { removed: search };
}

// ───────────────────────── jobs ─────────────────────────

const loadJobs = () => readJson('jobs', 'all', []);
const saveJobs = (jobs) => writeJson('jobs', 'all', jobs);

/** A job link without tracking parts, so the same job found twice is one record. */
export function normalizeUrl(u) {
  try {
    const url = new URL(String(u).trim());
    const keep = ['jk', 'vjk', 'id', 'jobid', 'job_id', 'currentjobid', 'projectid'];
    const params = [...url.searchParams].filter(([k]) => keep.includes(k.toLowerCase())).sort();
    const qs = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${url.protocol}//${url.host.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${qs}`;
  } catch { return ''; }
}
const sameJobKey = (j) => `${slug(j.title)}|${slug(j.company)}`;
const idFor = (key) => crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);

/** Save jobs read from a results page. Repeats (same link, or same title + company) are skipped; a longer text updates the record. */
export function jobsAdd(p, now = Date.now()) {
  const site = str(p.site, 30).toLowerCase() || 'other';
  if (!SITES[site]) throw new FixError(`unknown site "${p.site}"`, `use one of: ${Object.keys(SITES).join(', ')}`);
  let incoming = p.jobs;
  if (typeof incoming === 'string') { try { incoming = JSON.parse(incoming); } catch { throw new FixError('jobs is not valid JSON', 'pass "jobs" as an array of { title, company, url, ... }'); } }
  if (!Array.isArray(incoming) || !incoming.length) throw new FixError('jobs is empty', 'pass "jobs": the jobs read from the page, each { title, company, location, salary, experience, posted, url, description, remote }');
  const search = p.search ? readJson('searches', p.search, null) : null;
  const jobs = loadJobs();
  const byUrl = new Map(jobs.filter((j) => j.url).map((j) => [j.url, j]));
  const byKey = new Map(jobs.map((j) => [sameJobKey(j), j]));
  const added = [], updated = [], repeats = [], invalid = [];
  for (const raw of incoming.slice(0, 100)) {
    const title = str(raw?.title, 200);
    const url = raw?.url ? normalizeUrl(raw.url) : '';
    const company = str(raw?.company || raw?.client, 200);
    if (!title || (!url && !company)) { invalid.push(title || '(no title)'); continue; }
    const job = {
      title, company, url,
      location: str(raw.location, 200), salary: str(raw.salary || raw.budget, 200), experience: str(raw.experience, 100),
      posted: str(raw.posted, 100), description: str(raw.description, MAX_DESC), remote: raw.remote === true || raw.remote === 'true',
      skills: raw.skills ? list(raw.skills).slice(0, 30) : undefined,
    };
    const prev = (url && byUrl.get(url)) || byKey.get(sameJobKey(job));
    if (prev) {
      if (job.description.length > (prev.description || '').length + 40) {
        Object.assign(prev, Object.fromEntries(Object.entries(job).filter(([, v]) => v !== '' && v !== undefined)));
        prev.score = null;
        updated.push(prev.id);
      } else repeats.push(prev.id);
      continue;
    }
    const rec = { id: idFor(url || sameJobKey(job)), site, kind: search?.kind || SITES[site].kind, search: search?.id || null, ...job, foundAt: new Date(now).toISOString(), status: 'found', score: null, reasons: '', history: [] };
    if (raw.kind === 'freelance' || raw.kind === 'job') rec.kind = raw.kind;
    jobs.push(rec);
    if (url) byUrl.set(url, rec);
    byKey.set(sameJobKey(rec), rec);
    added.push(rec.id);
  }
  saveJobs(jobs);
  if (search) writeJson('searches', search.id, { ...search, lastRunAt: new Date(now).toISOString(), lastFound: added.length });
  return { added, updated, repeats, invalid, total: jobs.length };
}

/** Score every job without a score (or all with rescore). */
export function jobsScore(p = {}, now = Date.now()) {
  const profile = needProfile();
  const jobs = loadJobs();
  let n = 0;
  for (const j of jobs) {
    if (j.score != null && !p.rescore) continue;
    const r = scoreJob(j, profile, now);
    j.score = r.score; j.reasons = r.reasons;
    n++;
  }
  saveJobs(jobs);
  return { scored: n, jobs };
}

const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1) || String(b.foundAt).localeCompare(String(a.foundAt));

export function jobsList(p = {}) {
  let jobs = loadJobs();
  if (p.status) jobs = jobs.filter((j) => j.status === p.status);
  else if (!p.all) jobs = jobs.filter((j) => !['dismissed', 'lost'].includes(j.status));
  if (p.min_score != null) jobs = jobs.filter((j) => (j.score ?? 0) >= Number(p.min_score));
  if (p.site) jobs = jobs.filter((j) => j.site === p.site);
  if (p.kind) jobs = jobs.filter((j) => j.kind === p.kind);
  return jobs.sort(byScore).slice(0, Math.min(200, Number(p.limit) || 25));
}

export function getJob(id) {
  const j = loadJobs().find((x) => x.id === id);
  if (!j) throw new FixError(`no job "${id}"`, 'use an id from jobs_list or jobs_digest');
  return j;
}

export function jobsMark(p, now = Date.now()) {
  if (!STATUSES.includes(p.status)) throw new FixError(`unknown status "${p.status}"`, `use one of: ${STATUSES.join(', ')}`);
  const ids = [].concat(p.job || p.jobs || []).map(String);
  if (!ids.length) throw new FixError('job is missing', 'pass "job": an id from jobs_list (or a list of ids)');
  const jobs = loadJobs();
  const done = [];
  for (const id of ids) {
    const j = jobs.find((x) => x.id === id);
    if (!j) throw new FixError(`no job "${id}"`, 'use an id from jobs_list or jobs_digest');
    j.history = [...(j.history || []), { at: new Date(now).toISOString(), from: j.status, to: p.status, note: str(p.note, 500) || undefined }].slice(-20);
    j.status = p.status;
    if (p.note) j.note = str(p.note, 500);
    done.push(j);
  }
  saveJobs(jobs);
  return done;
}

/** New matches of the last hours, best first. */
export function jobsDigest(p = {}, now = Date.now()) {
  const hours = Number(p.hours) || 24;
  const min = p.min_score != null ? Number(p.min_score) : 60;
  const since = now - hours * 3_600_000;
  const all = loadJobs();
  const fresh = all.filter((j) => Date.parse(j.foundAt) >= since);
  const matches = fresh.filter((j) => j.status === 'found' && (j.score ?? 0) >= min).sort(byScore);
  return { hours, min_score: min, found: fresh.length, unscored: fresh.filter((j) => j.score == null).length, matches: matches.slice(0, Number(p.limit) || 15), more: Math.max(0, matches.length - (Number(p.limit) || 15)) };
}

export function jobsStatus() {
  const jobs = loadJobs();
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const j of jobs) counts[j.status] = (counts[j.status] || 0) + 1;
  const warnings = [];
  const profile = profileGet();
  if (!profile) warnings.push('no profile yet: share your CV');
  const searches = searchList();
  if (!searches.length) warnings.push('no saved searches yet');
  return {
    profile: profile ? { name: profile.name, headline: profile.headline, skills: profile.skills?.length || 0 } : null,
    searches: searches.map((s) => ({ id: s.id, site: s.site, kind: s.kind, query: s.query, location: s.location, lastRunAt: s.lastRunAt, lastFound: s.lastFound ?? null })),
    counts, total: jobs.length, strong: jobs.filter((j) => j.status === 'found' && (j.score ?? 0) >= 70).length, warnings,
  };
}

// ───────────────────────── drafts and applying (J2) ─────────────────────────
// The agent writes a draft; only the app records what happens to it (the user's click, the browser's
// result), with jobs_draft_state, which the agent does not have.

/** What a draft can be: waiting for the user, being applied, done, or stopped with a reason. */
export const DRAFT_STATES = ['waiting', 'applying', 'sent', 'ready_for_you', 'needs_you', 'failed', 'rejected'];
/** Sites where the app submits after the user's OK. On freelance sites a proposal costs paid credits, so the user sends it. */
export const SUBMIT_SITES = ['naukri', 'linkedin', 'indeed', 'other'];

export function jobsDraft(p, now = Date.now()) {
  const profile = needProfile();
  const jobs = loadJobs();
  const j = jobs.find((x) => x.id === String(p.job || ''));
  if (!j) throw new FixError(`no job "${p.job}"`, 'use an id from jobs_list or jobs_digest');
  if (['dismissed', 'lost', 'won'].includes(j.status)) throw new FixError(`the job is ${j.status}`, 'pick another job, or ask the user first');
  if (j.draft && ['applying', 'sent'].includes(j.draft.state)) throw new FixError(`the application is already ${j.draft.state === 'sent' ? 'sent' : 'being sent'}`, 'do not write another one');
  const kind = p.kind === 'proposal' || p.kind === 'cover_letter' ? p.kind : j.kind === 'freelance' ? 'proposal' : 'cover_letter';
  const byUser = p.by_user === true || p.by_user === 'true';
  const c = checkDraft(p.text, { job: j, profile, kind, byUser });
  if (!c.ok) return { ok: false, job: j, check: c };
  j.draft = {
    kind, text: String(p.text).trim(), words: c.words, warnings: c.warnings.map((w) => w.warning),
    state: 'waiting', byUser, createdAt: j.draft?.createdAt || new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    note: '', submit: SUBMIT_SITES.includes(j.site),
  };
  if (j.status === 'found') {
    j.history = [...(j.history || []), { at: new Date(now).toISOString(), from: 'found', to: 'shortlisted', note: 'draft written' }].slice(-20);
    j.status = 'shortlisted';
  }
  saveJobs(jobs);
  return { ok: true, job: j, check: c };
}

/** Drafts by state (default: the ones that need the user). */
export function jobsDrafts(p = {}) {
  const states = p.state ? [].concat(p.state) : ['waiting', 'ready_for_you', 'needs_you', 'failed', 'applying'];
  return loadJobs().filter((j) => j.draft && states.includes(j.draft.state))
    .sort((a, b) => String(b.draft.updatedAt).localeCompare(String(a.draft.updatedAt)));
}

/** App only: record what happened to a draft. "sent" also marks the job applied. */
export function jobsDraftState(p, now = Date.now()) {
  if (!DRAFT_STATES.includes(p.state)) throw new FixError(`unknown state "${p.state}"`, `use one of: ${DRAFT_STATES.join(', ')}`);
  const jobs = loadJobs();
  const j = jobs.find((x) => x.id === String(p.job || ''));
  if (!j) throw new FixError(`no job "${p.job}"`, 'use an id from jobs_drafts');
  if (!j.draft) throw new FixError('the job has no draft', 'write one with jobs_draft first');
  j.draft.state = p.state;
  j.draft.note = str(p.note, 1000);
  j.draft.updatedAt = new Date(now).toISOString();
  if (p.state === 'sent') {
    j.draft.sentAt = j.draft.updatedAt;
    if (!['applied', 'replied', 'interview', 'offer', 'won'].includes(j.status)) {
      j.history = [...(j.history || []), { at: j.draft.updatedAt, from: j.status, to: 'applied', note: p.note ? str(p.note, 300) : 'applied from the Jobs tab' }].slice(-20);
      j.status = 'applied';
    }
  }
  saveJobs(jobs);
  return j;
}
