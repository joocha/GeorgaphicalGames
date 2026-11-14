import pg from 'pg';

// PostgreSQL access through node-postgres. Queries are plain SQL that follows
// the flows in docs/database.md (section 7); the schema itself stays owned by
// the Prisma migrations.

export function createPool(connectionString, options = {}) {
  if (!connectionString) return null;

  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...options,
  });

  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => console.error('PostgreSQL pool error:', err.message));
  return pool;
}

// Runs `fn(client)` inside one transaction; rolls back if it throws.
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
