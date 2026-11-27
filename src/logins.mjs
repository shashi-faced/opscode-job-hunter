// Signing in to the sites (0.5.0): the user signs in, never the agent.
//
// The agent opens a site's sign-in page in the visible browser (open_sign_in), asks the user
// whether they are signed in (ask_question), and records the answer here (jobs_login_mark).
// Searches, applications and inbox checks only run on sites the user confirmed. No password,
// code or cookie is ever stored or asked for: the browser keeps the user's own sign-in.
import { readJson, writeJson, FixError } from './store.mjs';

/** Sign-in pages (the browser opens these for the user). */
export const LOGIN_URLS = {
  naukri: 'https://www.naukri.com/nlogin/login',
  linkedin: 'https://www.linkedin.com/login',
  indeed: 'https://secure.indeed.com/auth',
  freelancer: 'https://www.freelancer.com/login',
  foundit: 'https://www.foundit.in/rio/login',
  shine: 'https://www.shine.com/myshine/login/',
  timesjobs: 'https://www.timesjobs.com/login',
  hirist: 'https://www.hirist.tech/login',
  cutshort: 'https://cutshort.io/',
  wellfound: 'https://wellfound.com/login',
  internshala: 'https://internshala.com/login/user',
  guru: 'https://www.guru.com/login.aspx',
  peopleperhour: 'https://www.peopleperhour.com/site/login',
};
/** Sites whose results only show (or only make sense) when signed in: searches wait for the user's yes there.
 *  On the others the listings are public: searching runs right away, and signing in is needed to apply. */
export const SIGN_IN_TO_SEARCH = ['naukri', 'linkedin', 'indeed', 'freelancer'];
export const SITE_NAMES = { naukri: 'Naukri', linkedin: 'LinkedIn', indeed: 'Indeed', freelancer: 'Freelancer', foundit: 'Foundit', shine: 'Shine', timesjobs: 'TimesJobs', hirist: 'Hirist', cutshort: 'Cutshort', wellfound: 'Wellfound', internshala: 'Internshala', weworkremotely: 'We Work Remotely', guru: 'Guru', peopleperhour: 'PeoplePerHour' };

const load = () => readJson('logins', 'state', {});

/** The sites in use (saved searches, or the ones named) with what the user said about signing in. */
export function loginStatus(sites = []) {
  const state = load();
  return [...new Set(sites)].filter((s) => LOGIN_URLS[s]).map((site) => {
    const s = state[site] || {};
    return { site, name: SITE_NAMES[site], login_url: LOGIN_URLS[site], signed_in: s.signed_in === true, skipped: s.skipped === true, at: s.at || null };
  });
}

/** Record the user's answer: signed in (yes), not signed in, or skip this site for now. */
export function loginMark(p, now = Date.now()) {
  const site = String(p.site || '').toLowerCase().trim();
  if (!LOGIN_URLS[site]) throw new FixError(`no sign-in for "${p.site}"`, `use one of: ${Object.keys(LOGIN_URLS).join(', ')}`);
  const yes = p.signed_in === true || p.signed_in === 'true';
  const skip = !yes && (p.skip === true || p.skip === 'true');
  const state = load();
  state[site] = { signed_in: yes, skipped: skip, at: new Date(now).toISOString() };
  writeJson('logins', 'state', state);
  return { site, name: SITE_NAMES[site], ...state[site] };
}

/** Whether the user confirmed being signed in to `site` (sites without a sign-in, like e-mail, always pass). */
export const signedIn = (site) => !LOGIN_URLS[site] || load()[site]?.signed_in === true;
/** Whether a search on `site` must wait for the user to sign in (public listings do not). */
export const searchNeedsSignIn = (site) => SIGN_IN_TO_SEARCH.includes(site) && !signedIn(site);
