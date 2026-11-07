import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const targets = Object.freeze({
  dev0: { env: 'dev', database: 'c5c0eee5-a223-4ea2-974e-f4aee5a28bab', namespace: 'd53b296ce05a49c3a8cabf705ebae94d' },
  develop: { env: 'qa', database: '80d87a73-6615-4823-b7a4-19a8821b4f87', namespace: '0af6247a41cb45deaab5337d813d93e7' },
  main: { env: 'prod', database: 'f9b709fd-56c3-4a0b-8141-4542327c9d4d', namespace: '5b403d17b4014e29abbb52eb9525b16f' }
});
export const account = 'fabf4409ef32f8c64354a1a099bef2a2';
export const migrations = [
  { file: '033_voice_early_end_grace.sql', table: 'users', columns: ['voice_grace_session_id', 'voice_grace_used_at'] },
  { file: '035_voice_audio_readiness.sql', table: 'voice_interview_controls', columns: ['audio_check_deadline_at', 'audio_ready_at', 'audio_check_mode'], index: 'idx_voice_audio_check_rate' }
];

export function releaseTarget({ event, ref, sha, repository }) {
  const branch = ref?.replace(/^refs\/heads\//, '');
  if (event !== 'push' || ref !== `refs/heads/${branch}` || !targets[branch] ||
      !/^[a-f0-9]{40}$/.test(sha || '') || repository !== 'dlarosa92/jobhackai-site') {
    throw Error('Voice release requires a push to the exact dev0, develop or main branch.');
  }
  return { ...targets[branch], branch, sha };
}

export function planMigrations(schema) {
  return migrations.filter(m => {
    const names = schema[m.table];
    if (!Array.isArray(names) || !names.length) throw Error(`Missing base table: ${m.table}`);
    const present = m.columns.filter(c => names.includes(c));
    if (present.length && present.length !== m.columns.length) throw Error(`Partial migration requires review: ${m.file}`);
    if (present.length && m.index && !schema.indexes.includes(m.index)) throw Error(`Missing migration index: ${m.index}`);
    return present.length === 0;
  });
}

export function verifyBindings(settings, target) {
  const get = name => settings.bindings.find(b => b.name === name);
  const db = get('DB');
  // The Workers settings API identifies D1 with id. Some responses also
  // include the configuration alias; reject disagreement when both exist.
  if (db?.id !== target.database || (db.database_id !== undefined && db.database_id !== target.database) || get('ENVIRONMENT')?.text !== target.env ||
      get('VOICE_DEADLINES')?.namespace_id !== target.namespace || get('VOICE_DEADLINES')?.class_name !== 'VoiceDeadline' ||
      get('VOICE_DEADLINES_ENABLED')?.text !== 'true' || get('OPENAI_API_KEY')?.type !== 'secret_text') {
    throw Error('Existing voice worker bindings or enablement differ from the reviewed target.');
  }
}

async function main() {
  process.chdir(fileURLToPath(new URL('../', import.meta.url)));
  const target = releaseTarget({ event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY });
  const apply = process.argv.includes('--apply-schema');
  const verifyDeployment = process.argv.includes('--verify-deployment');
  const verifyOnly = process.argv.includes('--verify-only') || verifyDeployment;
  if (apply && verifyOnly) throw Error('Choose apply or verify, not both.');
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw Error('Missing Cloudflare CI token.');
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== account) throw Error('Cloudflare CI account differs from the reviewed target.');
  async function cf(path, body) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok || !data.success || data.result?.some?.(r => r.success === false)) {
      // Numeric API codes distinguish authentication, scope and request
      // failures without printing provider messages, headers or credentials.
      const codes = (Array.isArray(data.errors) ? data.errors : [])
        .map(error => error.code).filter(Number.isSafeInteger).slice(0, 8);
      throw Error(`Cloudflare release check failed (${response.status}; codes ${codes.join(',') || 'none'}) for ${path.split('/').at(-1)}.`);
    }
    return data.result;
  }
  async function currentHead() {
    const response = await fetch(`https://api.github.com/repos/dlarosa92/jobhackai-site/git/ref/heads/${target.branch}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }
    });
    const body = await response.json();
    if (!response.ok || body.object?.sha !== target.sha) throw Error('Branch advanced; refusing a stale release.');
  }
  async function schema() {
    const result = await cf(`d1/database/${target.database}/query`, { sql:
      "SELECT name FROM pragma_table_info('users'); SELECT name FROM pragma_table_info('voice_interview_controls'); SELECT name FROM sqlite_master WHERE type='index' AND name='idx_voice_audio_check_rate';" });
    return { users: result[0].results.map(r => r.name), voice_interview_controls: result[1].results.map(r => r.name), indexes: result[2].results.map(r => r.name) };
  }
  await currentHead();
  verifyBindings(await cf(`workers/scripts/jobhackai-voice-deadlines-${target.env}/settings`), target);
  const config = JSON.parse(await readFile('workers/voice-deadlines/wrangler.jsonc', 'utf8'));
  const configured = config.env[target.env];
  if (config.account_id !== account || configured.name !== `jobhackai-voice-deadlines-${target.env}` ||
      configured.d1_databases[0].database_id !== target.database || configured.vars.ENVIRONMENT !== target.env ||
      configured.vars.VOICE_DEADLINES_ENABLED !== 'true') throw Error('Source configuration differs from the verified environment.');
  const pending = planMigrations(await schema());
  const receipt = { environment: target.env, branch: target.branch, commit: target.sha,
    checkedAt: new Date().toISOString(), pending: pending.map(m => m.file), applied: [], verifyOnly };
  if (verifyOnly && pending.length) throw Error('Required voice schema is not ready.');
  if (apply && pending.length) {
    const backup = await cf(`d1/database/${target.database}/time_travel/bookmark`);
    if (typeof backup.bookmark !== 'string' || !backup.bookmark.length) throw Error('No recovery bookmark; refusing migration.');
    receipt.recoveryBookmark = backup.bookmark;
    // Persist the recovery point before the first mutation. Never restore automatically.
    await writeFile('voice-release-receipt.json', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    for (const migration of pending) {
      await currentHead();
      const sql = await readFile(`app/db/migrations/${migration.file}`, 'utf8');
      await cf(`d1/database/${target.database}/query`, { sql });
      receipt.applied.push(migration.file);
      await writeFile('voice-release-receipt.json', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    }
    if (planMigrations(await schema()).length) throw Error('Schema verification failed after migration.');
  }
  await currentHead();
  if (verifyDeployment) {
    const deployed = await cf(`workers/scripts/jobhackai-voice-deadlines-${target.env}/deployments`);
    const current = deployed.deployments?.[0];
    if (current?.annotations?.['workers/message'] !== `Voice CI ${target.sha}; run ${process.env.GITHUB_RUN_ID}` ||
        current.versions?.length !== 1 || current.versions[0].percentage !== 100) {
      throw Error('Live worker deployment does not match this exact CI release.');
    }
    receipt.deployment = current.id;
    receipt.workerVersion = current.versions[0].version_id;
  }
  await writeFile(verifyOnly ? 'voice-release-verification.json' : 'voice-release-receipt.json', JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ environment: target.env, commit: target.sha, pending: receipt.pending, applied: receipt.applied, verifyOnly }));
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
