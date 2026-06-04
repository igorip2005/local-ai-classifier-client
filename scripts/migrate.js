import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = await readFile(path.join(__dirname, '..', 'sql', '001_init.sql'), 'utf8');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(sql);
  console.log('Migrations applied');
} finally {
  await pool.end();
}
