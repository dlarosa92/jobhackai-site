import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const [worker, html, css, app, guide] = await Promise.all([
  readFile(new URL('./src/worker.js', import.meta.url), 'utf8'),
  readFile(new URL('./src/index.html', import.meta.url), 'utf8'),
  readFile(new URL('./src/style.css', import.meta.url), 'utf8'),
  readFile(new URL('./src/app.js', import.meta.url), 'utf8'),
  readFile(new URL('./OPERATING-GUIDE.md', import.meta.url), 'utf8'),
]);

const bundled = `const GUIDE = ${JSON.stringify(guide)};\nconst PAGE = ${JSON.stringify(html)};\nconst CSS = ${JSON.stringify(css)};\nconst APP = ${JSON.stringify(app)};\n${worker}`;
await build({
  stdin: { contents: bundled, resolveDir: fileURLToPath(new URL('./src', import.meta.url)), sourcefile: 'worker.js' },
  outfile: fileURLToPath(new URL('./worker.bundle.js', import.meta.url)),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
});
await build({
  entryPoints: [fileURLToPath(new URL('./src/gmail-ingest.js', import.meta.url))],
  outfile: fileURLToPath(new URL('./gmail-ingest.bundle.js', import.meta.url)),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
});
console.log('Built dashboard and Gmail ingestion Workers');
