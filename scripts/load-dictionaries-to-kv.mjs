import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dictDir = join(__dirname, '../app/functions/dictionaries');
const wordsPath = join(dictDir, 'english-words.txt');

console.log('Loading english-words dictionary into KV...');

try {
  execSync(
    `cd ${join(
      __dirname,
      '../app'
    )} && npx wrangler kv:key put --binding=JOBHACKAI_KV dictionary:english-words --path="${wordsPath}"`,
    { stdio: 'inherit' }
  );
  console.log('✅ Dictionary loaded into KV successfully');
} catch (error) {
  console.error('❌ Failed to load dictionary into KV:', error.message);
  process.exit(1);
}


