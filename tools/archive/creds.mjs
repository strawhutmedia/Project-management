// Shared S3 client for the archive tools. Requires the archive key pair
// (S3 read/write, no delete) in env — a fresh session must get it from Ryan;
// see docs/ARCHIVE_MIGRATION_STATUS.md "Tools" for how he retrieves it.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'))
export const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3')

export const BUCKET = 'strawhut-master-archive'

export function s3() {
  const accessKeyId = process.env.ARCHIVE_AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.ARCHIVE_AWS_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    console.error('Set ARCHIVE_AWS_ACCESS_KEY_ID and ARCHIVE_AWS_SECRET_ACCESS_KEY first (ask Ryan — see docs/ARCHIVE_MIGRATION_STATUS.md).')
    process.exit(1)
  }
  return new S3Client({ region: 'us-west-2', credentials: { accessKeyId, secretAccessKey } })
}

// List every object under a prefix; returns [{key, size}].
export async function listAll(client, prefix) {
  const out = []
  let token
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }))
    for (const o of r.Contents ?? []) out.push({ key: o.Key, size: o.Size ?? 0, modified: o.LastModified })
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out
}
