import path from 'node:path'
import { validateAll } from '../lib/validate.mjs'

const dir = path.resolve(process.argv[2] || 'fixtures/boutique')
const result = validateAll(dir)
if (result.ok) {
  console.log(`VALID ${dir}`)
  process.exit(0)
}
console.error(`INVALID ${dir} (${result.errors.length} errors)`)
for (const e of result.errors.slice(0, 30)) {
  console.error(`  ${e.path}: ${e.message}`)
}
process.exit(1)
