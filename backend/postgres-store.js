import pg from 'pg';
import { seedData } from './seed.js';

// The row lock makes every update atomic across concurrent Vercel instances.
export async function createPostgresStore(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 15000, allowExitOnIdle: true });
  await pool.query('CREATE TABLE IF NOT EXISTS bright_future_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL)');
  const initial = seedData(); initial.orders = [];
  await pool.query('INSERT INTO bright_future_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [JSON.stringify(initial)]);
  return {
    async read() { return (await pool.query('SELECT data FROM bright_future_state WHERE id = 1')).rows[0].data; },
    async update(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const data = (await client.query('SELECT data FROM bright_future_state WHERE id = 1 FOR UPDATE')).rows[0].data;
        const result = fn(data);
        await client.query('UPDATE bright_future_state SET data = $1 WHERE id = 1', [JSON.stringify(data)]);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
