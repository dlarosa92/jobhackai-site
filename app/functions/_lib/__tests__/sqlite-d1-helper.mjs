// Real SQLite, bound parameters and transactions; no SQL-pattern simulation.
// Python's stdlib keeps this runnable on the billing CI's Node 20 without npm.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runner = `import json, sqlite3, sys
request = json.load(sys.stdin)
db = sqlite3.connect(sys.argv[1])
db.row_factory = sqlite3.Row
db.execute('PRAGMA foreign_keys=ON')
try:
  if 'script' in request:
    db.executescript(request['script'])
    result = []
  else:
    db.execute('BEGIN')
    result = []
    for statement in request['statements']:
      cursor = db.execute(statement['sql'], statement['args'])
      result.append({'success': True, 'results': [dict(row) for row in cursor.fetchall()], 'meta': {'changes': max(cursor.rowcount, 0)}})
    db.commit()
  print(json.dumps({'result': result}))
except Exception as error:
  db.rollback()
  print(json.dumps({'error': str(error)}))
finally:
  db.close()
`;

export function sqliteD1() {
  const dir = mkdtempSync(join(tmpdir(), 'revenue-d1-'));
  const path = join(dir, 'test.sqlite');
  const execute = (request) => {
    const output = JSON.parse(execFileSync('python3', ['-c', runner, path], { input: JSON.stringify(request), encoding: 'utf8' }));
    if (output.error) throw new Error(output.error);
    return output.result;
  };
  return {
    prepare(sql) {
      const statement = {
        sql, args: [],
        bind(...args) { return { ...statement, args }; },
        async all() { return execute({ statements: [this] })[0]; },
        async first(column) { const row = (await this.all()).results[0]; return column ? row?.[column] ?? null : row ?? null; },
        async run() { return this.all(); }
      };
      return statement;
    },
    async batch(statements) { return execute({ statements }); },
    exec(script) { return execute({ script }); },
    close() { rmSync(dir, { recursive: true, force: true }); }
  };
}
