import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dictDir = join(__dirname, '../app/functions/dictionaries');
const wordsPath = join(dictDir, 'english-words.txt');

console.log('Loading english-words dictionary into KV...');

try {
  // Use namespace-id directly (from wrangler.local.toml)
  // Dev namespace ID: 5237372648c34aa6880f91e1a0c9708a
  // Preview namespace ID: 06a6323598244fc8a1b2daadeec8a043
  const namespaceId = process.env.KV_NAMESPACE_ID || '5237372648c34aa6880f91e1a0c9708a';
  
  execSync(
    `cd ${join(__dirname, '../app')} && npx wrangler kv:key put --namespace-id=${namespaceId} dictionary:english-words --path="${wordsPath}"`,
    { stdio: 'inherit' }
  );
  console.log('✅ Dictionary loaded into KV successfully');
} catch (error) {
  console.error('❌ Failed to load dictionary into KV:', error.message);
  process.exit(1);
}


