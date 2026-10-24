#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { allowed } from '../src/access.js';

// Credentials are installed separately on each executor; never put them in a prompt.
const origin = 'https://dashboard.jobhackai.io';
const [verb, path, payloadFile] = process.argv.slice(2);
const method = (verb || '').toUpperCase();
const identity = {role:'machine', capabilities:['read','prepare','reconcile','contribute','coordinate']};
try {
  if (!allowed(identity,method,path || '') || new URL(path,origin).origin !== origin) throw new Error('Unsupported machine operation. Use GET or POST and an allowed /api/ path.');
  if ((method==='POST') !== !!payloadFile) throw new Error('POST requires a JSON payload file; GET takes no payload.');
  const credentialPath = process.env.JOBHACKAI_DASHBOARD_CREDENTIALS || resolve(homedir(),'.local/share/jobhackai/dashboard-access/credentials.json');
  const info = await stat(credentialPath);
  if (process.platform!=='win32' && (info.mode & 0o077)) throw new Error('Credential file must be private (mode 600).');
  const credential = JSON.parse(await readFile(credentialPath,'utf8'));
  if (credential.origin!==origin || typeof credential.clientId!=='string' || !credential.clientId.endsWith('.access') || typeof credential.clientSecret!=='string' || !credential.clientSecret) throw new Error('Invalid dashboard credential configuration.');
  const body = payloadFile ? await readFile(resolve(payloadFile),'utf8') : undefined;
  if (body) JSON.parse(body);
  const response = await fetch(new URL(path,origin), {method,redirect:'error',signal:AbortSignal.timeout(30000),body,headers:{'CF-Access-Client-Id':credential.clientId,'CF-Access-Client-Secret':credential.clientSecret,...(body?{'Content-Type':'application/json'}:{})}});
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`Dashboard returned HTTP ${response.status} without API JSON. Check Access configuration.`);
  const result=await response.json();
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  if (!response.ok) process.exitCode=1;
} catch(error) {
  // Do not print fetch request objects or credential-bearing headers.
  process.stderr.write(`${error.message}\n`);process.exitCode=1;
}
