// Megaphone IABv2 download export reader (the authoritative download source).
//
// Megaphone writes a gzipped JSON file per UTC day to an S3 bucket, one row per
// delivery event: { episode_id, podcast_id, delivery_type: 'download'|'play', … }.
// We count 'download' rows per podcast to rank shows by real downloads.
//
// Config (Railway env vars — copy from the Podbooster service):
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
//   MEGAPHONE_EXPORTS_S3_BUCKET
//   MEGAPHONE_DOWNLOAD_DAYS  (optional, default 3 — how many recent days to sum)

import zlib from 'node:zlib';

const REGION = (process.env.AWS_REGION || '').trim();
const BUCKET = (process.env.MEGAPHONE_EXPORTS_S3_BUCKET || '').trim();
const ACCESS_KEY = (process.env.AWS_ACCESS_KEY_ID || '').trim();
const SECRET_KEY = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();

export function s3Configured() {
  return !!(REGION && BUCKET && ACCESS_KEY && SECRET_KEY);
}

let _client = null;
async function client() {
  if (_client) return _client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  _client = new S3Client({ region: REGION, credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } });
  return _client;
}

const DELIVERY_RE = /(?:^|\/)delivery-v2-day-(\d{4}-\d{2}-\d{2})\.json(\.gz)?$/i;
const FINALIZED_RE = /(?:^|\/)_finalized_delivery_(\d{4}-\d{2}-\d{2})(?:[_.].*)?$/i;

async function listFiles() {
  const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
  const c = await client();
  const files = [];
  let token;
  do {
    const resp = await c.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
    for (const o of resp.Contents || []) files.push({ Key: o.Key, ETag: o.ETag, Size: o.Size });
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return files;
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
async function getObject(key) {
  const { GetObjectCommand } = await import('@aws-sdk/client-s3');
  const c = await client();
  const resp = await c.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return streamToBuffer(resp.Body);
}

function parseExport(buffer, gz) {
  const raw = gz ? zlib.gunzipSync(buffer) : buffer;
  const text = raw.toString('utf8').trim();
  if (!text) return [];
  if (text[0] === '[') return JSON.parse(text);
  const rows = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch {}
  }
  return rows;
}

/** Sum 'download' events per podcast_id across the most recent N export days. */
export async function downloadsByPodcastId({ days = parseInt(process.env.MEGAPHONE_DOWNLOAD_DAYS || '3', 10), log = () => {} } = {}) {
  if (!s3Configured()) return null;
  const files = await listFiles();
  const finalized = new Set();
  const deliveries = [];
  for (const f of files) {
    const fm = f.Key.match(FINALIZED_RE);
    if (fm) finalized.add(fm[1]);
    const dm = f.Key.match(DELIVERY_RE);
    if (dm) deliveries.push({ key: f.Key, date: dm[1], gz: !!dm[2] });
  }
  // newest dates first, one file per date (prefer .gz)
  const byDate = new Map();
  for (const d of deliveries) if (!byDate.has(d.date)) byDate.set(d.date, d);
  const chosen = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, Math.max(1, days));

  const counts = new Map();
  let totalRows = 0;
  for (const d of chosen) {
    try {
      const rows = parseExport(await getObject(d.key), d.gz);
      totalRows += rows.length;
      for (const row of rows) {
        if (!row || row.delivery_type !== 'download') continue;
        const pid = row.podcast_id != null ? String(row.podcast_id) : null;
        if (!pid) continue;
        counts.set(pid, (counts.get(pid) || 0) + 1);
      }
      log(`s3: ${d.key} (${d.date}${finalized.has(d.date) ? ', final' : ''}) → ${rows.length} rows`);
    } catch (e) {
      log(`s3: ${d.key} failed — ${e.message}`);
    }
  }
  log(`s3: summed ${totalRows} rows across ${chosen.length} day(s), ${counts.size} podcasts`);
  return counts;
}

/** Diagnostic: bucket reachability + a sample of what's there. */
export async function probe() {
  if (!s3Configured()) return { configured: false };
  try {
    const files = await listFiles();
    const deliveries = files.filter((f) => DELIVERY_RE.test(f.Key)).map((f) => f.Key).sort().slice(-5);
    let sampleKeys = [];
    const newest = files.filter((f) => DELIVERY_RE.test(f.Key)).sort((a, b) => a.Key.localeCompare(b.Key)).pop();
    if (newest) {
      const rows = parseExport(await getObject(newest.Key), newest.Key.endsWith('.gz'));
      sampleKeys = rows[0] ? Object.keys(rows[0]) : [];
    }
    return { configured: true, fileCount: files.length, recentDeliveryFiles: deliveries, sampleRowKeys: sampleKeys };
  } catch (e) {
    return { configured: true, error: e.message };
  }
}
