// Download one file from the vault (use for _INVENTORY census files, which
// are STANDARD class — Deep Archive objects need a restore first).
// Usage: node fetch-inventory.mjs <key> <outfile>
import fs from 'node:fs'
import { s3, BUCKET, GetObjectCommand } from './creds.mjs'
const [key, out] = process.argv.slice(2)
const c = s3()
const r = await c.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
fs.writeFileSync(out, Buffer.from(await r.Body.transformToByteArray()))
console.log('saved', out, fs.statSync(out).size, 'bytes')
