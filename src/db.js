import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
});

const jsonbColumns = new Set([
  'request_body', 'response_body', 'ollama_timings',
  'cpu_before', 'cpu_after', 'cpu_delta',
  'gpu_before', 'gpu_after', 'gpu_delta',
  'power_before', 'power_after', 'power_delta',
  'process_before', 'process_after', 'process_delta',
  'meta',
]);

export async function insertAiRequest(row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => jsonbColumns.has(column) ? JSON.stringify(row[column] ?? null) : row[column]);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const sql = `INSERT INTO ai_requests (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING id`;
  const result = await pool.query(sql, values);
  return result.rows[0].id;
}
