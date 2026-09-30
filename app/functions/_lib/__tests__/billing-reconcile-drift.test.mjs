import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BILLING_FIELDS, buildApplySql, sqlValue } from '../../../scripts/lib/billing-reconcile-core.mjs';

const dir = mkdtempSync(join(tmpdir(), 'billing-drift-'));
try {
  const fields = ['id', 'auth_id', ...BILLING_FIELDS];
  const rows = [1, 2].map((id) => ({
    ...Object.fromEntries(BILLING_FIELDS.map((f) => [f, null])),
    id, auth_id: `uid_${id}`, plan: 'free', subscription_status: 'canceled', has_ever_paid: 0
  }));
  const classification = { classes: { LEGIT: [] }, repairRowIds: [1, 2] };
  const allowlist = { legit: [], repair: rows.map(({ id, auth_id }) => ({ id, auth_id })) };
  const sql = buildApplySql('drift_test_1', rows, classification, allowlist, {}, '2026-09-06T00:00:00.000Z');
  const scenarios = [null, "plan='monthly'", "stripe_customer_id='cus_new'", "stripe_subscription_id='sub_new'",
    "auth_id='changed_owner'", "plan_updated_at='2026-09-06T01:00:00.000Z'", "has_ever_paid=1", 'DELETE'];
  for (const [i, change] of scenarios.entries()) {
    const db = join(dir, `${i}.sqlite`);
    const query = (text) => execFileSync('sqlite3', ['-json', db, text], { encoding: 'utf8' }).trim();
    query(`CREATE TABLE users (id INTEGER PRIMARY KEY, auth_id TEXT NOT NULL, ${BILLING_FIELDS.map((f) => `${f} ${f === 'has_ever_paid' ? 'INTEGER' : 'TEXT'}`).join(', ')}, updated_at TEXT);
      CREATE TABLE billing_repair_audit (run_id TEXT, mode TEXT, user_row_id INTEGER, auth_id TEXT, stripe_customer_id TEXT, stripe_subscription_id TEXT, old_values_json TEXT NOT NULL, new_values_json TEXT NOT NULL);
      ${rows.map((r) => `INSERT INTO users (${fields.join(',')}) VALUES (${fields.map((f) => sqlValue(r[f])).join(',')});`).join('\n')}`);
    if (change) query(change === 'DELETE' ? 'DELETE FROM users WHERE id=2' : `UPDATE users SET ${change} WHERE id=2`);
    const before = query('SELECT * FROM users ORDER BY id');
    const result = spawnSync('sqlite3', [db], { input: `.bail on\nBEGIN;\n${sql}\nCOMMIT;\n`, encoding: 'utf8' });
    if (change) {
      assert.notEqual(result.status, 0, `must abort for ${change}`);
      assert.match(result.stderr, /NOT NULL constraint failed/);
      assert.equal(query('SELECT * FROM users ORDER BY id'), before, 'earlier updates roll back too');
      assert.equal(query('SELECT COUNT(*) AS n FROM billing_repair_audit'), '[{"n":0}]');
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(query('SELECT COUNT(*) AS n FROM billing_repair_audit'), '[{"n":2}]');
      assert.equal(query('SELECT COUNT(*) AS n FROM users WHERE subscription_status IS NULL'), '[{"n":2}]');
    }
  }
  console.log('billing repair: no drift commits; changed/deleted rows abort every audit and update atomically');
} finally { rmSync(dir, { recursive: true, force: true }); }
