// How well a job fits the profile: 0-100 with the reasons, worked out in code (same input, same score).
// The agent may add its own judgment with jobs_mark, but the number the user sees comes from here.

const norm = (s) => String(s ?? '').toLowerCase();

/** A skill found in the text as a whole word ("react" not in "reactive"; "node.js", "c++" kept as written). */
export function hasTerm(text, term) {
  const t = norm(term).trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z0-9+#])${esc}(?=$|[^a-z0-9+#])`, 'i').test(norm(text));
}

/** Other spellings of common skills, so "nodejs" in a job matches "Node.js" in the profile. */
const ALIASES = {
  'node.js': ['node', 'nodejs', 'node js'], 'react': ['reactjs', 'react.js', 'react js'],
  'javascript': ['js', 'es6'], 'typescript': ['ts'], 'next.js': ['nextjs', 'next js'],
  'vue': ['vuejs', 'vue.js'], 'angular': ['angularjs'], 'postgresql': ['postgres'],
  'golang': ['go'], 'kubernetes': ['k8s'], 'machine learning': ['ml'], 'react native': ['react-native'],
};
export const skillMatches = (text, skill) => hasTerm(text, skill) || (ALIASES[norm(skill)] || []).some((a) => hasTerm(text, a));

/** Indian salary in lakhs per year from "8-12 Lacs PA", "₹10,00,000 - 15,00,000", "12 LPA". Null when not stated. */
export function salaryLpa(text) {
  const s = norm(text).replace(/,/g, '');
  if (!s || /not disclosed/.test(s)) return null;
  let m = /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:lacs?|lakhs?|lpa|l\b)/.exec(s);
  if (m) return { min: +m[1], max: +m[2] };
  m = /(\d+(?:\.\d+)?)\s*(?:lacs?|lakhs?|lpa)/.exec(s);
  if (m) return { min: +m[1], max: +m[1] };
  const rupees = [...s.matchAll(/(\d{6,8})/g)].map((x) => +x[1] / 100000);
  if (rupees.length) return { min: Math.min(...rupees), max: Math.max(...rupees) };
  return null;
}

/** Hourly rate in dollars from "$15.00-$30.00", "$25/hr", "Hourly: $20 - $40". Null for fixed price or not stated. */
export function hourlyRate(text) {
  const s = norm(text).replace(/,/g, '');
  if (!s || /fixed/.test(s)) return null;
  const nums = [...s.matchAll(/\$\s*(\d+(?:\.\d+)?)/g)].map((x) => +x[1]);
  if (!nums.length || !/hour|hr|\/h\b/.test(s)) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Years asked from "3-5 Yrs", "5+ years", "2 to 4 years". */
export function yearsAsked(text) {
  const s = norm(text);
  let m = /(\d+)\s*(?:-|to)\s*(\d+)\s*(?:yrs?|years?)/.exec(s);
  if (m) return { min: +m[1], max: +m[2] };
  m = /(\d+)\s*\+\s*(?:yrs?|years?)/.exec(s);
  if (m) return { min: +m[1], max: null };
  return null;
}

/** Days since "Just now", "Today", "3 days ago", "30+ days ago", "2 weeks ago", or an ISO date. */
export function ageDays(posted, now = Date.now()) {
  const s = norm(posted).trim();
  if (!s) return null;
  if (/just now|today|hour|minute|few/.test(s)) return 0;
  if (/yesterday/.test(s)) return 1;
  const m = /(\d+)\s*\+?\s*(day|week|month)/.exec(s);
  if (m) return +m[1] * (m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 86_400_000));
}

const isRemote = (job) => job.remote === true || /\b(remote|work from home|wfh|anywhere)\b/.test(norm(`${job.location} ${job.title} ${job.description}`));

/**
 * Score one job against the profile. Returns { score, reasons, fit, gaps }:
 * fit = what matches, gaps = what does not; reasons is both in one short line for the list.
 */
export function scoreJob(job, profile, now = Date.now()) {
  const p = profile || {};
  const title = norm(job.title);
  const text = `${job.title} ${job.description || ''} ${job.skills ? [].concat(job.skills).join(' ') : ''}`;
  const fit = [];
  const gaps = [];
  let score = 0;

  const skills = [...new Set([].concat(p.skills || []).map((s) => String(s).trim()).filter(Boolean))];
  const matched = skills.filter((s) => skillMatches(text, s));
  if (skills.length) {
    // Result pages show only a few skills per job, so each match counts, up to five.
    score += [0, 20, 32, 40, 46, 50][Math.min(matched.length, 5)];
    if (matched.length) fit.push(`skills: ${matched.slice(0, 5).join(', ')}`);
    else gaps.push('none of your skills named');
  }

  const roles = [].concat(p.roles || []).map(norm).filter(Boolean);
  const inTitle = skills.find((sk) => skillMatches(job.title, sk));
  if (job.kind === 'freelance') {
    // Gigs are named after the work ("Build a React dashboard"), not a role.
    if (inTitle) { score += 20; fit.push(`${inTitle} in the title`); }
  } else if (roles.length) {
    const full = roles.find((r) => title.includes(r));
    const words = roles.flatMap((r) => r.split(/\s+/)).filter((w) => w.length > 2 && !['developer', 'engineer', 'senior', 'junior', 'lead'].includes(w));
    const part = words.find((w) => hasTerm(title, w));
    if (full) { score += 20; fit.push(`role: ${full}`); }
    else if (part) { score += 10; fit.push(`role: ${part}`); }
    else if (inTitle) { score += 10; fit.push(`${inTitle} in the title`); }
    else gaps.push('different role');
  } else score += 10;

  const freelance = job.kind === 'freelance';
  if (freelance) score += 10;
  else {
    const locs = [].concat(p.locations || []).map(norm).filter(Boolean);
    const remote = isRemote(job);
    if (remote && p.remote !== false) { score += 10; fit.push('remote'); }
    else if (!locs.length) score += 5;
    else if (locs.some((l) => norm(job.location).includes(l))) { score += 10; fit.push(`in ${locs.find((l) => norm(job.location).includes(l))}`); }
    else { score -= 10; gaps.push(`in ${job.location || 'another place'}`); }
  }

  if (!freelance && p.min_salary_lpa) {
    const sal = salaryLpa(job.salary);
    if (sal && sal.max < p.min_salary_lpa) { score -= 15; gaps.push(`pays up to ${sal.max} LPA`); }
    else if (sal) { score += 5; fit.push(`pays ${sal.min === sal.max ? sal.max : `${sal.min}-${sal.max}`} LPA`); }
  }
  if (freelance && p.rate_hourly) {
    const r = hourlyRate(job.salary || job.budget);
    if (r && r.max < p.rate_hourly) { score -= 15; gaps.push(`up to $${r.max}/hr`); }
    else if (r) { score += 5; fit.push(`$${r.min}-${r.max}/hr`); }
  }

  if (!freelance && p.years != null) {
    const y = yearsAsked(`${job.experience || ''} ${job.title} ${job.description || ''}`);
    if (y && (p.years + 1 < y.min || (y.max != null && p.years > y.max + 3))) { score -= 10; gaps.push(`asks ${y.min}${y.max != null ? `-${y.max}` : '+'} yrs`); }
    else if (y) { score += 10; fit.push(`${y.min}${y.max != null ? `-${y.max}` : '+'} yrs fits`); }
  }

  const age = ageDays(job.posted, now);
  if (age != null && age > 30) { score -= 5; gaps.push(`posted ${age} days ago`); }

  const avoid = [].concat(p.avoid || []).filter((w) => String(w).trim());
  const bad = avoid.find((w) => hasTerm(`${job.title} ${job.company || ''} ${job.description || ''}`, w));
  if (bad) { score = Math.min(score, 10); gaps.unshift(`has "${bad}" (you avoid it)`); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const reasons = [...fit, ...gaps.map((g) => `✗ ${g}`)].join(' · ');
  return { score, reasons, fit, gaps };
}
