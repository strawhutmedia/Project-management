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

export async function writeStatusFile(filePath: string, content: string, message?: string): Promise<{ ok: boolean; error?: string }> {
  const headers = authHeader()
  if (!headers) return { ok: false, error: 'no_github_token' }
  const sha = await getFileSha(filePath)
  const body = {
    message: message || `status: update ${filePath}`,
    content: Buffer.from(content).toString('base64'),
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
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `github_${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function appendStatusJsonl(filePath: string, entry: unknown): Promise<{ ok: boolean; error?: string }> {
  const headers = authHeader()
  if (!headers) return { ok: false, error: 'no_github_token' }
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
      if (data.encoding === 'base64') {
        existing = Buffer.from(data.content, 'base64').toString('utf8')
      }
    }
  } catch {
    // ignore
  }
  const lines = existing.split('\n').filter(Boolean).slice(-200)
  lines.push(JSON.stringify(entry))
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
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `github_${res.status}: ${text.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
