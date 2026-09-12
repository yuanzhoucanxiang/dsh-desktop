/** Node-only compatibility adapter for P1 tests. The actual controller lives in
 * client.js; never maintain a second implementation merely to test it. */
import fs from 'node:fs'
import vm from 'node:vm'
let client
vm.runInNewContext(fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
  URLSearchParams, AbortController, setTimeout, clearTimeout, crypto: globalThis.crypto,
  localStorage: { getItem: () => null }, navigator: { language: 'zh-CN' }, console,
  window: { __ModuleLoader__: { load: entry => { client = entry.factory(() => ({})) } } },
})
export const createEditorSession = client.createEditorSession