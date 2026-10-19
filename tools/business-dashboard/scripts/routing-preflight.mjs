#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { normalizeEmail, routingCheck } from '../src/outreach-policy.js';

// A successful result proves public routing only. The review/send gate still
// requires first-party source, business fit, Gmail history and exact approval.
try {
  if (process.argv.length !== 3) throw new Error('Usage: routing-preflight.mjs packet.json');
  const packet=JSON.parse(await readFile(process.argv[2],'utf8'));
  if(!Array.isArray(packet.messages)||!packet.messages.length)throw new Error('Expected a non-empty messages array.');
  const domains=new Set();
  for(const item of packet.messages){const address=normalizeEmail(item.recipient||item.message?.recipient);if(!address)throw new Error('Invalid recipient syntax; recheck the original source.');domains.add(address.split('@')[1]);}
  const checks=[];
  // Bound concurrency and preserve a clear per-domain diagnostic.
  for(const domain of [...domains].sort())checks.push(await routingCheck(domain));
  const cleared=checks.every(check=>check.status==='routing_present_mailbox_unknown');
  process.stdout.write(JSON.stringify({purpose:'Public DNS only; not mailbox proof or send authorization',cleared,checks},null,2)+'\n');
  process.exitCode=cleared?0:1;
} catch(error){process.stderr.write(error.message+'\n');process.exitCode=2;}
