// 真包重建（B07/B01 要求的"用最终代码重新打包"）：输出放 %TEMP%（工作区规则），只做 dir 目标、不签名、不发布
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'

const repo = 'E:/Deepseek harness/dsh-desktop'
const require = createRequire(path.join(repo, 'package.json'))
const builder = require('electron-builder')
const pkg = require(path.join(repo, 'package.json'))

const out = path.join(process.env.TEMP, `wm-v2-rebuild-${pkg.version}`)
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
console.log('[rebuild] output =', out)

try {
  await builder.build({
    targets: builder.Platform.WINDOWS.createTarget(['dir'], builder.Arch.x64),
    publish: 'never',
    config: {
      directories: { output: out },
      win: { signAndEditExecutable: false },
    },
  })
  // 记录产物目录，供后续探针/复核脚本使用（与复核者的 package-probe 约定一致）
  fs.writeFileSync(path.join(process.env.TEMP, 'wm-v2-review-package-path.txt'), out)
  console.log('[rebuild] BUILD_OK', out)
} catch (err) {
  console.error('[rebuild] BUILD_FAIL', err?.message || err)
  process.exitCode = 1
}
