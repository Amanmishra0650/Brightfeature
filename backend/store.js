import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { seedData } from './seed.js';

export async function createStore(directory) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'store.json');
  let data;
  try { data = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; data = seedData(); await writeFile(path, JSON.stringify(data, null, 2)); }
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(data),
    update(fn) {
      const job = queue.then(async () => {
        const next = structuredClone(data);
        const result = fn(next);
        await writeFile(path + '.tmp', JSON.stringify(next, null, 2));
        await rename(path + '.tmp', path);
        data = next;
        return result;
      });
      queue = job.catch(() => {});
      return job;
    },
  };
}
