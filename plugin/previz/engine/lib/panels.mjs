/**
 * 分镜图入库（panel ingestion）——不是 VLM 语义理解。
 *
 * 做三件事：
 *   1. 扫描 panels/ 下的图片，按自然顺序编号（01、2、10 而不是 1、10、2）；
 *   2. 读 PNG/JPEG 头拿真实宽高（不引第三方库）；
 *   3. 生成 `panels.draft.csv`，标 `status=draft`，**必须人工确认**后才能写成 storyboard.csv。
 *
 * 明确的非目标：从画面里猜景别/构图/人物/动作。那些字段给默认值，并在 `assumptions` 里列出。
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseCsv } from './storyboard.mjs'
import { ScreenwriterError } from './errors.mjs'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** 自然排序：panel2 < panel10。 */
export function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g
  const ax = String(a).match(re) || []
  const bx = String(b).match(re) || []
  for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
    const an = /^\d+$/.test(ax[i])
    const bn = /^\d+$/.test(bx[i])
    if (an && bn) {
      const d = Number(ax[i]) - Number(bx[i])
      if (d) return d
    } else if (ax[i] !== bx[i]) {
      return ax[i] < bx[i] ? -1 : 1
    }
  }
  return ax.length - bx.length
}

/** 读 PNG / JPEG / WebP 的真实像素尺寸；不认识就返回 null（不猜）。 */
export function imageSize(file) {
  try {
    const buf = fs.readFileSync(file)
    if (buf.length < 24) return null
    // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width@16 height@20
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' }
    }
    // WebP: RIFF....WEBP
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const type = buf.toString('ascii', 12, 16)
      if (type === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), format: 'webp' }
      if (type === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: 'webp' }
      if (type === 'VP8L') {
        const b = buf.readUInt32LE(21)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, format: 'webp' }
      }
      return null
    }
    // JPEG: FF D8, then scan markers for SOF0..SOF3/SOF5..SOF15
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++
          continue
        }
        const marker = buf[i + 1]
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2
          continue
        }
        const len = buf.readUInt16BE(i + 2)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: 'jpeg' }
        }
        i += 2 + len
      }
      return null
    }
    return null
  } catch {
    return null
  }
}

export function listPanels(projectDir) {
  const dir = path.join(path.resolve(projectDir), 'panels')
  if (!fs.existsSync(dir)) return { dir, files: [] }
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort(naturalCompare)
  return { dir, files }
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * 生成草案行。默认景别/机位/焦距来自参数；主体来自 --subject 或 blocking 第一个演员。
 * `status=draft` 是硬标记：confirm 之前不能当输入。
 */
export function draftRows({ files, dir, scene = 'S01', subject = 'SUBJECT', duration = 3, size = 'MS', lens = 35, angle = 'eye', move = 'static', startPanel = 1 }) {
  return files.map((name, i) => {
    const abs = path.join(dir, name)
    const dim = imageSize(abs)
    const panel = startPanel + i
    return {
      panel,
      scene,
      shot: `${scene}-${String(panel).padStart(2, '0')}`,
      beat: '',
      duration,
      size,
      angle,
      lens_mm: lens,
      move,
      subject,
      action: path.basename(name, path.extname(name)),
      dialogue: '',
      transition: 'cut',
      image: `panels/${name}`,
      // 分镜图草案不知道走位，默认跟拍主体：否则一台 static 相机在几秒里会把人甩出画。
      notes: `status=draft; follow=${subject}; ${dim ? `${dim.width}x${dim.height}` : 'unknown-size'}`,
      width: dim?.width ?? null,
      height: dim?.height ?? null,
    }
  })
}

export function rowsToCsv(rows) {
  const header = ['panel', 'scene', 'shot', 'beat', 'duration', 'size', 'angle', 'lens_mm', 'move', 'subject', 'action', 'dialogue', 'transition', 'image', 'notes']
  const lines = [header.join(',')]
  for (const r of rows) lines.push(header.map((h) => csvCell(r[h])).join(','))
  return lines.join('\n') + '\n'
}

/** 扫描 + 写 panels.draft.csv；不覆盖 storyboard.csv。 */
export function writePanelDraft(projectDir, opts = {}) {
  const project = path.resolve(projectDir)
  const { dir, files } = listPanels(project)
  if (!files.length) throw new ScreenwriterError(`没有找到分镜图：${dir}（支持 ${[...IMAGE_EXT].join('/')}）`)
  const rows = draftRows({ files, dir, ...opts })
  const out = path.join(project, 'panels.draft.csv')
  fs.writeFileSync(out, rowsToCsv(rows), 'utf8')
  const missingSize = rows.filter((r) => !r.width).length
  return { out, rows, dir, missingSize, files }
}

/**
 * 人工确认：读回 draft，检查每行仍是 draft 且被显式确认，然后写 storyboard.csv。
 * 不是自动“相信”——`--confirm` 只是把人的动作记录下来。
 */
export function confirmPanelDraft(projectDir, { confirmedBy = 'human', log = console.log } = {}) {
  const project = path.resolve(projectDir)
  const draftPath = path.join(project, 'panels.draft.csv')
  if (!fs.existsSync(draftPath)) throw new ScreenwriterError(`没有草案：${draftPath}（先跑 previz panels <project>）`)
  const text = fs.readFileSync(draftPath, 'utf8')
  if (!/status=draft/.test(text)) throw new ScreenwriterError('草案里没有 status=draft 标记，拒绝确认（可能已被改过）')
  // 用 RFC 4180 解析，而不是 split(',')：图片名/动作里出现逗号或引号时 split 会错位。
  const rows = parseCsv(text).slice(1).filter((cells) => cells.some((c) => String(c).trim() !== ''))
  const header = parseCsv(text)[0] || []
  const imageCol = header.indexOf('image')
  if (imageCol < 0) throw new ScreenwriterError('草案缺少 image 列，拒绝确认')
  for (const [i, cells] of rows.entries()) {
    if (cells.length < header.length) throw new ScreenwriterError(`第 ${i + 2} 行列数 ${cells.length} 少于表头 ${header.length}，拒绝确认`)
    const image = cells[imageCol]
    if (!image) throw new ScreenwriterError(`第 ${i + 2} 行 image 为空，拒绝确认`)
    if (!fs.existsSync(path.join(project, image))) throw new ScreenwriterError(`第 ${i + 2} 行的分镜图不存在：${image}`)
  }
  const target = path.join(project, 'storyboard.csv')
  const stamped = text.replace(/status=draft/g, `status=confirmed-by-${confirmedBy}`)
  fs.writeFileSync(target, stamped, 'utf8')
  log(`[previz] panels confirmed -> ${path.relative(process.cwd(), target)}（${rows.length} 行，确认人 ${confirmedBy}）`)
  return { out: target, rows: rows.length }
}
