import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecodeAll } from './zstd.mjs'

export const DEFAULT_ROOT = 'C:/Users/Ellis/.dsh/sessions'

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(p)
    else if (entry.name === 'session.v4.jsonl.zstd') yield p
  }
}

/** 枚举全部 session 日志文件（稳定排序）。 */
export function listSessionFiles(root = DEFAULT_ROOT) {
  return [...walk(root)].sort()
}

/** 解码 + 解析一个 session 日志：{ file, header, events, badLines }。 */
export function loadSession(file) {
  const buf = readFileSync(file)
  const { text, frames, bytes } = zstdDecodeAll(buf)
  const lines = text.split('\n').filter(Boolean)
  let header = null
  const events = []
  let badLines = 0
  for (const line of lines) {
    let record
    try {
      record = JSON.parse(line)
    } catch {
      badLines += 1
      continue
    }
    if (record && record.type === 'session') {
      header = record
      continue
    }
    events.push(record)
  }
  return { file, header, events, badLines, frames, bytes, rawBytes: buf.length }
}
