// Cloudflare D1 counts trigger effects in meta.changes. SQLite's run().changes
// excludes them, which hid a deployed regression in optimistic-write checks.
export function d1Run(sql,query,args=[]) {
  const before=sql.prepare('SELECT total_changes() AS n').get().n;
  sql.prepare(query).run(...args);
  return {meta:{changes:sql.prepare('SELECT total_changes() AS n').get().n-before}};
}
