const GITHUB_API = 'https://api.github.com'
const REPO_OWNER = process.env.STATUS_REPO_OWNER || 'strawhutmedia'
const REPO_NAME = process.env.STATUS_REPO_NAME || 'Project-management'
const STATUS_BRANCH = process.env.STATUS_BRANCH || 'status'

function authHeader() {
  const token = process.env.GITHUB_TOKEN
  if (!token) return null
  return { Authorization: `Bearer ${token}`, 'User-Agent': 'slate-status-reporter' }
}

export function statusReportingEnabled(): boolean {
  return Boolean(process.env.GITHUB_TOKEN)
}

async function getFileSha(filePath: string): Promise<string | undefined> {
  const headers = authHeader()
  if (!headers) return undefined
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(filePath)}?ref=${STATUS_BRANCH}`,
      { headers },
    )
    if (!res.ok) return undefined
    const data = (await res.json()) as { sha?: string }
    return data.sha
  } catch {
    return undefined
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A stale-SHA conflict on the status branch is expected under concurrent
// writes (multiple boots, the build-check workflow pushing too). GitHub
// returns 409 (and sometimes 422) in that case; the fix is to re-fetch the
// current SHA and retry, not to error out and email the admin.
export async function writeStatusFile(filePath: string, content: string, message?: string): Promise<{ ok: boolean; error?: string }> {
  const headers = authHeader()
  if (!headers) return { ok: false, error: 'no_github_token' }
  const b64 = Buffer.from(content).toString('base64')
  let lastErr = ''
  for (let attempt = 0; attempt < 5; attempt++) {
    const sha = await getFileSha(filePath)
    const body = {
      message: message || `status: update ${filePath}`,
      content: b64,
      branch: STATUS_BRANCH,
      sha,
    }
    try {
      const res = await fetch(
        `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(filePath)}`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (res.ok) return { ok: true }
      const text = await res.text()
      lastErr = `github_${res.status}: ${text.slice(0, 200)}`
      // Conflict (stale sha) → re-fetch sha and retry; other errors are terminal.
      if (res.status !== 409 && res.status !== 422) return { ok: false, error: lastErr }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    await sleep(200 * (attempt + 1))
  }
  return { ok: false, error: lastErr }
}

export async function appendStatusJsonl(filePath: string, entry: unknown): Promise<{ ok: boolean; error?: string }> {
  const headers = authHeader()
  if (!headers) return { ok: false, error: 'no_github_token' }
  const line = JSON.stringify(entry)
  let lastErr = ''
  // Re-read → append → write each attempt so a concurrent append isn't lost
  // and the sha is always current. Retry on conflict.
  for (let attempt = 0; attempt < 5; attempt++) {
    let existing = ''
    let sha: string | undefined
    try {
      const res = await fetch(
        `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(filePath)}?ref=${STATUS_BRANCH}`,
        { headers },
      )
      if (res.ok) {
        const data = (await res.json()) as { sha: string; content: string; encoding: string }
        sha = data.sha
        if (data.encoding === 'base64') existing = Buffer.from(data.content, 'base64').toString('utf8')
      }
    } catch {
      // ignore — treat as empty/new file this attempt
    }
    const lines = existing.split('\n').filter(Boolean).slice(-200)
    lines.push(line)
    const body = {
      message: `status: append ${filePath}`,
      content: Buffer.from(lines.join('\n') + '\n').toString('base64'),
      branch: STATUS_BRANCH,
      sha,
    }
    try {
      const res = await fetch(
        `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodeURIComponent(filePath)}`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (res.ok) return { ok: true }
      const text = await res.text()
      lastErr = `github_${res.status}: ${text.slice(0, 200)}`
      if (res.status !== 409 && res.status !== 422) return { ok: false, error: lastErr }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    await sleep(200 * (attempt + 1))
  }
  return { ok: false, error: lastErr }
}
