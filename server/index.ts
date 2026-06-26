import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'path'
import { runMigrations } from './db'
import { authRouter } from './routes/auth'
import { meRouter } from './routes/me'
import { projectsRouter } from './routes/projects'
import { songsRouter } from './routes/songs'
import { integrationsRouter } from './routes/integrations'
import { adminRouter } from './routes/admin'
import { notificationsRouter } from './routes/notifications'
import { budgetsRouter } from './routes/budgets'
import { stripboardRouter } from './routes/stripboard'
import { transcriptsRouter } from './routes/transcripts'
import { clipsRouter } from './routes/clips'
import { socialsRouter } from './routes/socials'
import { podcastsRouter } from './routes/podcasts'
import { schedulerRouter as socialSchedulerRouter } from './routes/scheduler'
import { showChatRouter } from './routes/show_chat'
import { episodeCutsRouter } from './routes/episode_cuts'
import { seedBackInYourArms } from './seeds/back_in_your_arms'
import { ensureRyanIsPodcastEp } from './routes/projects'
import { startScheduler } from './scheduler'
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

// Catch malformed URI errors early (e.g., /%c0) and return 400 without logging
// These are typically from bots/scanners and are not actionable errors
app.use((req, res, next) => {
  try {
    decodeURIComponent(req.path)
    next()
  } catch (err) {
    if (err instanceof URIError) {
      // Silently reject with 400 - these are malformed requests, not server errors
      res.status(400).send('Bad Request')
    } else {
      next(err)
    }
  }
})

app.use(express.json({ limit: '20mb' }))
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
app.use('/api/admin', adminRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/budgets', budgetsRouter)
app.use('/api/stripboard', stripboardRouter)
app.use('/api/transcripts', transcriptsRouter)
app.use('/api/clips', clipsRouter)
app.use('/api/socials', socialsRouter)
app.use('/api/podcasts', podcastsRouter)
app.use('/api/scheduler', socialSchedulerRouter)
// show_chat mounts on /api directly because its routes are
// /api/projects/:id/chat — colocated with project-scoped endpoints.
app.use('/api', showChatRouter)
app.use('/api', episodeCutsRouter)

const clientDir = path.resolve(process.cwd(), 'dist')
logInfo('serving client from', { clientDir })
// Hashed assets (index-XXXX.js, index-YYYY.css) are cache-immutable; everything
// else (notably index.html) must NOT be cached or iOS Safari can pin the user
// to a stale bundle for up to an hour after a deploy.
app.use(express.static(clientDir, {
  index: false,
  setHeaders(res, file) {
    if (/\/assets\/.+\.(js|css|woff2?|ttf|svg|png|jpg|webp)$/.test(file)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    } else {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    }
  },
}))
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.sendFile(path.join(clientDir, 'index.html'), (err) => {
    if (err) {
      logError('sendFile failed', { error: err.message, clientDir })
      res.status(500).send('Slate is running but the client bundle is missing. Check /api/_diag.')
    }
  })
})

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Ignore client-side connection errors (e.g., browser closed during upload)
  // These are normal and shouldn't be logged as server errors
  const isClientAbort = err.message === 'request aborted' || 
                        (err as any).code === 'ECONNRESET' ||
                        (err as any).code === 'ECONNABORTED'
  
  if (isClientAbort) {
    // Silently ignore - no need to log or send response (client is gone)
    logInfo('client aborted request', { method: req.method, path: req.path })
    return
  }
  
  // Ignore malformed URI errors (from bots/scanners) - these are not actionable
  if (err instanceof URIError || err.message?.includes('Failed to decode param')) {
    res.status(400).send('Bad Request')
    return
  }
  
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
    await seedBackInYourArms()
    await ensureRyanIsPodcastEp()
  } catch (err) {
    logError('migrations failed', { error: err instanceof Error ? err.message : String(err) })
    markBootError(err)
    // continue anyway so /api/_diag can still respond and tell us what's wrong
  }
  app.listen(PORT, '0.0.0.0', () => {
    markBootComplete()
    logInfo(`listening on :${PORT}`)
    void reportStatus()
    startScheduler()
    // Pick up any breakdown runs that were killed by the previous
    // shutdown (deploy / crash). Producers don't have to click
    // "re-analyze" after every Railway redeploy.
    void import('./scene_breakdown').then(({ resumeIncompleteBreakdowns }) => {
      void resumeIncompleteBreakdowns()
    })
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
