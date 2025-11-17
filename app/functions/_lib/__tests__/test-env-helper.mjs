import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create a test env stub that mimics Cloudflare Worker KV binding.
 * For Node tests, reads dictionary files from disk.
 */
export function createTestEnv() {
  return {
    JOBHACKAI_KV: {
      async get(key, type) {
        if (key !== 'dictionary:english-words') {
          return null;
        }

        const dictPath = join(__dirname, '../../dictionaries', 'english-words.txt');
        try {
          const fileData = readFileSync(dictPath);
          if (type === 'arrayBuffer') {
            return fileData.buffer;
          }
          if (type === 'text' || type === 'string' || !type) {
            return fileData.toString('utf8');
          }
          return fileData.toString('utf8');
        } catch (error) {
          console.error(`[TEST] Failed to load dictionary: ${dictPath}`, error);
          return null;
        }
      },
      async put() {},
      async delete() {}
    }
  };
}


