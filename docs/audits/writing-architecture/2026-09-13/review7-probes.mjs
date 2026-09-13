// Reuse unchanged storage schedules from review 5 against this checkout.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../../..')
let code = fs.readFileSync(path.join(here, 'review5-probes.mjs'), 'utf8')
const original = "const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..')"
if (!code.includes(original)) throw Error('review5 probe layout changed')
code = code.replace(original, `const repo=${JSON.stringify(repo)}`)
  .replaceAll('wm-review5-', 'wm-review7-')
  .replaceAll('53223df', '2c3ab6e').replaceAll('b642ad4', 'a58b3c7')
await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
