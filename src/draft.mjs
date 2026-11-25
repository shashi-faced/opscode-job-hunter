// Cover letters and proposals: checked before they are kept, so nothing untrue or half-finished
// reaches an employer or client. The agent writes the text; this checks it against the profile.
import { skillMatches, hasTerm } from './score.mjs';

/** Skills the check knows, besides the job's own tags and the profile, to catch a claimed skill the user does not have. */
const KNOWN_SKILLS = [
  'react', 'angular', 'vue', 'svelte', 'next.js', 'nuxt', 'node.js', 'express', 'nestjs', 'django', 'flask', 'fastapi', 'spring', 'spring boot',
  'laravel', 'php', 'ruby', 'rails', 'python', 'java', 'kotlin', 'swift', 'go', 'golang', 'rust', 'c#', '.net', 'c++', 'scala', 'typescript', 'javascript',
  'graphql', 'redux', 'tailwind', 'sass', 'webpack', 'react native', 'flutter', 'android', 'ios', 'electron',
  'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'kafka', 'rabbitmq', 'dynamodb', 'firebase', 'supabase',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'ci/cd', 'linux',
  'machine learning', 'deep learning', 'tensorflow', 'pytorch', 'nlp', 'computer vision', 'llm', 'langchain', 'data science', 'pandas', 'spark', 'hadoop', 'power bi', 'tableau', 'sql',
  'figma', 'photoshop', 'illustrator', 'wordpress', 'shopify', 'magento', 'salesforce', 'sap', 'seo', 'selenium', 'cypress', 'playwright', 'jest',
];

export const LIMITS = {
  cover_letter: { min: 60, max: 350, label: 'cover letter' },
  proposal: { min: 60, max: 400, label: 'proposal' },
};

const NEGATION = /\b(not|never|no|haven'?t|have not|don'?t|do not|new to|learning|keen to learn|eager to learn|willing to learn|picking up|basic)\b/i;
const sentences = (text) => String(text).split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
const words = (text) => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’.+#-]*/gu) || []).length;

/**
 * Check a draft. Errors stop it from being kept (each with the exact fix); warnings are shown.
 * byUser: the user's own edit; their words are theirs, so only the hard limits apply.
 */
export function checkDraft(text, { job, profile, kind, byUser = false }) {
  const errors = [];
  const warnings = [];
  const t = String(text || '').trim();
  const lim = LIMITS[kind] || LIMITS.cover_letter;
  const n = words(t);
  if (!t) return { ok: false, errors: [{ error: 'the text is empty', fix: 'write the text' }], warnings, words: 0 };
  if (t.length > 5000) errors.push({ error: `${t.length} characters (sites take up to 5000)`, fix: 'shorten it' });
  if (!byUser && n < lim.min) errors.push({ error: `${n} words is too short for a ${lim.label}`, fix: `write ${lim.min}-${lim.max} words: why this job, what you did that fits it, a clear close` });
  if (!byUser && n > lim.max) errors.push({ error: `${n} words is too long for a ${lim.label}`, fix: `cut it to ${lim.max} words or fewer` });

  const ph = /\[[^\]\n]{2,40}\]|\{\{?[^}\n]{1,40}\}?\}|<[A-Z][A-Za-z _]{2,30}>|\blorem ipsum\b|\b(TODO|TBD|XXX)\b|your name here|company name here/i.exec(t);
  if (ph) errors.push({ error: `"${ph[0]}" is a placeholder`, fix: 'fill it in from the job or the profile, or remove it' });

  if (kind === 'proposal') {
    // Freelance sites do not allow contact details before a contract; an account can be suspended for it.
    const contact = /[\w.+-]+@[\w-]+\.[\w.]+|(?:\+?\d[\s-]?){10,}|\b(whatsapp|telegram|skype)\b/i.exec(t);
    if (contact) errors.push({ error: `"${contact[0]}" is contact information`, fix: 'remove it: freelance sites do not allow e-mail, phone or chat apps in proposals' });
  }

  if (!byUser && profile) {
    // Years: never more than the profile says.
    for (const m of t.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs)/gi)) {
      const sentence = sentences(t).find((s) => s.includes(m[0])) || '';
      if (profile.years != null && +m[1] > profile.years && !/\b(team|company|client|you|your|project)\b/i.test(sentence)) {
        errors.push({ error: `"${m[0]}" claims more experience than the profile (${profile.years} years)`, fix: `say ${profile.years} years, or ask the user and update the profile` });
      }
    }
    // Skills: a skill named as the user's own must be in the profile.
    const have = [].concat(profile.skills || []);
    const pool = [...new Set([...KNOWN_SKILLS, ...[].concat(job?.skills || []).map((s) => String(s).toLowerCase())])];
    const flagged = new Set();
    for (const s of sentences(t)) {
      if (NEGATION.test(s)) continue;
      for (const skill of pool) {
        if (flagged.has(skill) || !hasTerm(s, skill)) continue;
        if (have.some((h) => skillMatches(skill, h) || skillMatches(h, skill) || hasTerm(skill, h))) continue;
        // Naming the client's stack ("your Django app") is fine; claiming it is not.
        if (/\b(your|you use|you're using|you are using|you need|you are looking|your team|the team uses|the company uses|client's|clients?)\b/i.test(s)) continue;
        flagged.add(skill);
        errors.push({ error: `it presents "${skill}" as the user's skill, but it is not in the profile`, fix: `remove it, or say plainly the user has not used it yet; if the user says they have it, add it with jobs_profile_set first` });
      }
    }
  }
  if (job?.company && !byUser && kind === 'cover_letter' && !hasTerm(t, job.company)) warnings.push({ warning: `it does not name ${job.company}` });
  return { ok: errors.length === 0, errors, warnings, words: n };
}
