// Run the accepted review9 schedules against the current checkout, with fresh evidence metadata.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const previous = path.join(__dirname, '../2026-09-13/review9-ui.cjs')
const code = fs.readFileSync(previous, 'utf8')
  .replaceAll("head:'1664467'", "head:'5a152dc'")
  .replaceAll('review9-ui.json', 'reassessment-ui.json')
  .replaceAll('REVIEW9_UI_EVIDENCE', 'REASSESSMENT_UI_EVIDENCE')
const compiled = new Module(__filename, module)
compiled.filename = __filename
compiled.paths = module.paths
compiled._compile(code, __filename)
