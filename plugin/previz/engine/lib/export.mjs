/**
 * 预演交付物导出：shots.csv + timeline.otio（OpenTimelineIO JSON）。
 * 只读 facts.json，不依赖 Blender / ffmpeg / 工作台。
 */
import fs from 'node:fs'
import path from 'node:path'

function pad(n) {
  return String(n).padStart(2, '0')
}

export function timecode(seconds, fps) {
  const total = Math.max(0, Math.round(Number(seconds) * Number(fps)))
  const f = total % fps
  const s = Math.floor(total / fps) % 60
  const m = Math.floor(total / (fps * 60)) % 60
  const h = Math.floor(total / (fps * 3600))
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`
}

function csvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildShotsCsv(facts) {
  const fps = Number(facts.fps) || 24
  const rows = [
    ['shot', 'in_seconds', 'out_seconds', 'duration_seconds', 'frames', 'fps', 'size', 'lens_mm', 'subjects', 'start_frame', 'end_frame', 'timecode_in'],
  ]
  for (const shot of facts.shots || []) {
    rows.push([
      shot.id,
      Number(shot.in).toFixed(3),
      Number(shot.out).toFixed(3),
      (Number(shot.out) - Number(shot.in)).toFixed(3),
      shot.frames,
      fps,
      shot.size,
      shot.lens_mm,
      (shot.subject_ids || []).join('|'),
      shot.start?.frame ?? '',
      shot.end?.frame ?? '',
      timecode(shot.in, fps),
    ])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

function rational(value, rate) {
  return { OTIO_SCHEMA: 'RationalTime.1', value, rate }
}

export function buildOtio(facts) {
  const fps = Number(facts.fps) || 24
  const children = (facts.shots || []).map((shot) => ({
    OTIO_SCHEMA: 'Clip.1',
    name: shot.id,
    source_range: {
      OTIO_SCHEMA: 'TimeRange.1',
      start_time: rational(shot.start?.frame ? shot.start.frame - 1 : 0, fps),
      duration: rational(shot.frames, fps),
    },
    metadata: {
      previz: {
        shot_id: shot.id,
        in_seconds: shot.in,
        out_seconds: shot.out,
        size: shot.size,
        lens_mm: shot.lens_mm,
        subjects: shot.subject_ids || [],
        start_frame: shot.start?.frame ?? null,
        end_frame: shot.end?.frame ?? null,
      },
    },
  }))
  return {
    OTIO_SCHEMA: 'Timeline.1',
    name: facts.scene || 'previz',
    global_start_time: rational(0, fps),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: [
        {
          OTIO_SCHEMA: 'Track.1',
          name: 'V1',
          kind: 'Video',
          children,
        },
      ],
    },
  }
}

export function exportTimeline(outDir, { log = console.log } = {}) {
  const dir = path.resolve(outDir)
  const factsPath = path.join(dir, 'facts.json')
  if (!fs.existsSync(factsPath)) throw new Error(`缺少 ${factsPath}；先跑 build/render`)
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'))
  const csv = path.join(dir, 'shots.csv')
  const otio = path.join(dir, 'timeline.otio')
  fs.writeFileSync(csv, buildShotsCsv(facts), 'utf8')
  fs.writeFileSync(otio, JSON.stringify(buildOtio(facts), null, 2), 'utf8')
  log(`[previz] export ${path.relative(process.cwd(), csv)}`)
  log(`[previz] export ${path.relative(process.cwd(), otio)}`)
  return { csv, otio }
}
