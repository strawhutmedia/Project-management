import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'path'
import { runMigrations } from './db'
import { authRouter } from './routes/auth'
import { meRouter } from './routes/me'
import { projectsRouter } from './routes/projects'
import { songsRouter } from './routes/songs'
import { integrationsRouter } from './routes/integrations'
import {
  diagRouter,
  logError,
  logInfo,
  markBootComplete,
  markBootError,
  markBootStart,
  reportStatus,
} from './diag'

const app = express()
const PORT = parseInt(process.env.PORT || '8080', 10)

app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

app.use('/api/_diag', diagRouter)
app.use('/api/auth', authRouter)
app.use('/api/me', meRouter)
app.use('/api/projects', projectsRouter)
app.use('/api/songs', songsRouter)
app.use('/api/integrations', integrationsRouter)

const clientDir = path.resolve(process.cwd(), 'dist')
logInfo('serving client from', { clientDir })
app.use(express.static(clientDir, { index: false, maxAge: '1h' }))
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'), (err) => {
    if (err) {
      logError('sendFile failed', { error: err.message, clientDir })
      res.status(500).send('Slate is running but the client bundle is missing. Check /api/_diag.')
    }
  })
})

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logError('unhandled error', { message: err.message, stack: err.stack })
  res.status(500).json({ error: 'internal_error', message: err.message })
})

async function start() {
  markBootStart()
  logInfo('boot starting', {
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV,
    hasDb: Boolean(process.env.DATABASE_URL),
    hasResend: Boolean(process.env.RESEND_API_KEY),
  })
  try {
    await runMigrations()
    logInfo('migrations complete')
  } catch (err) {
    logError('migrations failed', { error: err instanceof Error ? err.message : String(err) })
    markBootError(err)
    // continue anyway so /api/_diag can still respond and tell us what's wrong
  }
  app.listen(PORT, '0.0.0.0', () => {
    markBootComplete()
    logInfo(`listening on :${PORT}`)
    void reportStatus()
  })
}

start().catch((err) => {
  logError('fatal startup error', { error: err instanceof Error ? err.message : String(err) })
  markBootError(err)
  // keep the process alive long enough that /api/_diag can be reached
  app.listen(PORT, '0.0.0.0', () => {
    console.error(`[slate] degraded mode listening on :${PORT}`)
    void reportStatus()
  })
})
