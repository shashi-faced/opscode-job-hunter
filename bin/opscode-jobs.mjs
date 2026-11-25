#!/usr/bin/env node
// opscode-jobs CLI. The LAST line of stdout is always one JSON result object.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTool, TOOL_DEFS } from '../src/tools.mjs';
import { guide } from '../src/guide.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) { const [k, v] = a.slice(2).split('='); flags[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true); }
  else pos.push(a);
}
const done = (obj, code = 0) => { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(code); };

const HELP = `opscode-jobs — your CV and saved searches in, matching jobs and freelance gigs out

  doctor                        check Node.js, pdftotext and the data folder
  guide                         the steps of a search run and the job format
  status                        profile, searches and job counts
  digest                        matches of the last 24 hours
  tool <name> '<json params>'   generic bridge used by the Opscode app (or --b64 <base64 json>)
  tools                         list tool definitions (JSON)
  agent-manifest                manifest + tools for the Opscode app

Data: ~/.opscode/job-hunter (or $OPSCODE_JOBS_HOME)`;

async function main() {
  try {
    switch (cmd) {
      case 'doctor': {
        // Run by the app after install: Node version and a writable data folder.
        const { home } = await import('../src/store.mjs');
        const major = +process.versions.node.split('.')[0];
        const problems = [];
        if (major < 18) problems.push(`Node.js ${process.versions.node} is too old; install 18 or newer`);
        const notes = [];
        try { (await import('node:child_process')).execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); } catch (e) { if (e.code === 'ENOENT') notes.push('pdftotext not found: PDF CVs cannot be read (install poppler-utils), .docx and text still work'); }
        try { fs.mkdirSync(home(), { recursive: true }); fs.accessSync(home(), fs.constants.W_OK); } catch (e) { problems.push(`cannot write ${home()}: ${e.message}`); }
        if (!flags.quiet) process.stdout.write((problems.length ? problems.join('\n') : `ok: Node ${process.versions.node}, data in ${home()}`) + (notes.length ? `\n${notes.join('\n')}` : '') + '\n');
        return done({ ok: !problems.length, problems, notes, data: home() }, problems.length ? 1 : 0);
      }
      case 'guide':
        process.stdout.write(guide() + '\n');
        return done({ ok: true });
      case 'tools':
        return done({ ok: true, tools: TOOL_DEFS });
      case 'status': case 'digest': {
        const r = await runTool(cmd === 'status' ? 'jobs_status' : 'jobs_digest', {}, { cwd: process.cwd() });
        process.stdout.write(r.text + '\n');
        return done({ ok: r.ok, data: r.data }, r.ok ? 0 : 1);
      }
      case 'agent-manifest': {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'manifest.json'), 'utf8'));
        return done({ ok: true, manifest: { ...manifest, package: { installDir: ROOT, entry: 'bin/opscode-jobs.mjs', runtime: 'node', nodePath: process.execPath, tools: TOOL_DEFS } } });
      }
      case 'tool': {
        const name = pos[0];
        let params = {};
        const raw = pos[1] ?? flags.params;
        if (flags.b64) params = JSON.parse(Buffer.from(String(flags.b64), 'base64').toString('utf8'));
        else if (raw) params = raw.startsWith('@') ? JSON.parse(fs.readFileSync(raw.slice(1), 'utf8')) : JSON.parse(raw);
        const r = await runTool(name, params, { cwd: flags.cwd || process.cwd() });
        return done({ ok: r.ok, text: r.text, data: r.data }, 0);
      }
      case undefined: case 'help': case '--help': case '-h':
        process.stdout.write(HELP + '\n');
        return done({ ok: true, root: ROOT });
      default:
        return done({ ok: false, error: `unknown command "${cmd}"`, fix: 'run opscode-jobs help' }, 1);
    }
  } catch (e) {
    return done({ ok: false, error: e.message, fix: e.fix }, 1);
  }
}
main();
