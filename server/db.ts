import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.warn('[slate] DATABASE_URL is not set — database calls will fail.')
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl?.includes('railway.internal') ? false : { rejectUnauthorized: false },
})

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  const migrationsDir = path.resolve(__dirname, '../../server/migrations')
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM migrations WHERE name = $1', [file])
    if (rows.length > 0) continue
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
    console.log(`[slate] applying migration: ${file}`)
    await pool.query('BEGIN')
    try {
      await pool.query(sql)
      await pool.query('INSERT INTO migrations (name) VALUES ($1)', [file])
      await pool.query('COMMIT')
    } catch (err) {
      await pool.query('ROLLBACK')
      throw err
    }
  }
}
