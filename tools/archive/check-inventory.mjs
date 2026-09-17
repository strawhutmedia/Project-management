// List the census files in _INVENTORY/.
import { s3, listAll } from './creds.mjs'
const c = s3()
for (const o of await listAll(c, '_INVENTORY/')) console.log(o.key, o.size, o.modified?.toISOString())
