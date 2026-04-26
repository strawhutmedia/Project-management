import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'path'
import { runMigrations } from './db'
import { authRouter } from './routes/auth'
import { meRouter } from './routes/me'
import { projectsRouter } from './routes/projects'

const app = express()
const PORT = parseInt(process.env.PORT || '8080', 10)

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

app.use('/api/auth', authRouter)
app.use('/api/me', meRouter)
app.use('/api/projects', projectsRouter)

const clientDir = path.resolve(__dirname, '../../dist')
app.use(express.static(clientDir, { index: false, maxAge: '1h' }))
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'))
})

async function start() {
  console.log('[slate] running migrations...')
  await runMigrations()
  console.log('[slate] migrations complete')
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[slate] listening on :${PORT}`)
  })
}

start().catch((err) => {
  console.error('[slate] fatal startup error:', err)
  process.exit(1)
})
