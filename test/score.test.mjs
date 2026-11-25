import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob, hasTerm, skillMatches, salaryLpa, hourlyRate, yearsAsked, ageDays } from '../src/score.mjs';

const NOW = Date.UTC(2026, 10, 25, 6);
const profile = {
  skills: ['React', 'Node.js', 'TypeScript', 'Redux', 'PostgreSQL', 'AWS'], years: 4,
  roles: ['frontend developer', 'react developer'], locations: ['bengaluru'], remote: true,
  min_salary_lpa: 15, rate_hourly: 25, avoid: ['php', 'night shift'],
};
const job = (over = {}) => ({
  title: 'Senior React Developer', company: 'Acme', location: 'Bengaluru', salary: '18-25 Lacs PA', experience: '3-6 Yrs',
  posted: '2 days ago', description: 'React, Redux, TypeScript and Node.js. AWS a plus.', kind: 'job', ...over,
});

test('whole words only, with common other spellings', () => {
  assert.equal(hasTerm('We use React and Redux', 'react'), true);
  assert.equal(hasTerm('a reactive system', 'react'), false);
  assert.equal(hasTerm('C++ and C# devs', 'c++'), true);
  assert.equal(skillMatches('NodeJS backend', 'Node.js'), true);
  assert.equal(skillMatches('Postgres and k8s', 'kubernetes'), true);
});

test('pay, rate, years and age are read the way the sites write them', () => {
  assert.deepEqual(salaryLpa('8-12 Lacs PA'), { min: 8, max: 12 });
  assert.deepEqual(salaryLpa('₹ 10,00,000 - 15,00,000 P.A.'), { min: 10, max: 15 });
  assert.deepEqual(salaryLpa('12 LPA'), { min: 12, max: 12 });
  assert.equal(salaryLpa('Not disclosed'), null);
  assert.deepEqual(hourlyRate('Hourly: $15.00 - $30.00'), { min: 15, max: 30 });
  assert.equal(hourlyRate('Fixed-price: $500'), null);
  assert.deepEqual(yearsAsked('3-6 Yrs'), { min: 3, max: 6 });
  assert.deepEqual(yearsAsked('5+ years of experience'), { min: 5, max: null });
  assert.equal(ageDays('Just now', NOW), 0);
  assert.equal(ageDays('30+ days ago', NOW), 30);
  assert.equal(ageDays('2 weeks ago', NOW), 14);
});

test('a job that fits scores high and says why', () => {
  const r = scoreJob(job(), profile, NOW);
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.match(r.reasons, /skills: React, Node\.js, TypeScript, Redux, AWS/);
  assert.match(r.reasons, /role: react developer/);
  assert.match(r.reasons, /in bengaluru/);
  assert.match(r.reasons, /3-6 yrs fits/);
  assert.equal(r.gaps.length, 0);
});

test('what does not fit lowers the score and is named', () => {
  const base = scoreJob(job(), profile, NOW).score;
  const low = scoreJob(job({ salary: '6-9 Lacs PA' }), profile, NOW);
  assert.ok(low.score < base); assert.match(low.reasons, /✗ pays up to 9 LPA/);
  const far = scoreJob(job({ location: 'Gurugram' }), profile, NOW);
  assert.ok(far.score < base); assert.match(far.reasons, /✗ in Gurugram/);
  const senior = scoreJob(job({ experience: '10-15 Yrs' }), profile, NOW);
  assert.match(senior.reasons, /✗ asks 10-15 yrs/);
  const old = scoreJob(job({ posted: '45 days ago' }), profile, NOW);
  assert.match(old.reasons, /✗ posted 45 days ago/);
});

test('remote counts as a fit when the user takes remote work', () => {
  const r = scoreJob(job({ location: 'Remote' }), profile, NOW);
  assert.match(r.reasons, /remote/);
  assert.doesNotMatch(r.reasons, /✗ in/);
});

test('a word the user avoids rules the job out', () => {
  const r = scoreJob(job({ description: 'React and PHP, night shift' }), profile, NOW);
  assert.ok(r.score <= 10);
  assert.match(r.reasons, /✗ has "php" \(you avoid it\)/);
});

test('freelance: no place check, the hourly rate is', () => {
  const gig = { title: 'React dashboard for a SaaS app', kind: 'freelance', salary: 'Hourly: $30-$50', description: 'Need React + TypeScript', posted: 'yesterday' };
  const r = scoreJob(gig, profile, NOW);
  assert.match(r.reasons, /\$30-50\/hr/);
  const cheap = scoreJob({ ...gig, salary: 'Hourly: $8-$12' }, profile, NOW);
  assert.match(cheap.reasons, /✗ up to \$12\/hr/);
  assert.ok(cheap.score < r.score);
});

test('a job with nothing in common scores low', () => {
  const r = scoreJob(job({ title: 'Accountant', description: 'Tally, GST filing', salary: '', experience: '' }), profile, NOW);
  assert.ok(r.score < 30, `score ${r.score}`);
  assert.match(r.reasons, /✗ none of your skills named/);
});
