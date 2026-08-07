// One-time migration CLI: import every show from the current strawhutmedia.com.
//
//   node scripts/import-from-site.mjs
//
// (The admin has a one-click "Import all shows" button that does the same.)
// Every imported show defaults to "original"; reclassify partner shows in the
// admin. Re-running is safe — existing shows re-sync instead of duplicating.

import { createStore } from '../src/store.js';
import { importFromSite } from '../src/importer.js';

const store = await createStore();
const result = await importFromSite(store, { onProgress: (m) => console.log(m) });
const stats = await store.stats();
console.log('Totals:', stats, '| result:', result);
