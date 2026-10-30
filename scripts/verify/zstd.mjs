import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

const MAGIC = 0xFD2FB528

export function zstdDecodeAll(buf) {
  const out = []
  let off = 0
  let frames = 0
  while (off < buf.length) {
    if (buf.length - off < 4) {
      let allZero = true
      for (let i = off; i < buf.length; i++) if (buf[i] !== 0) { allZero = false; break }
      if (allZero) break
      throw new Error('trailing garbage at ' + off)
    }
    const magic = buf.readUInt32LE(off)
    if (magic !== MAGIC) throw new Error('bad magic at ' + off + ': 0x' + magic.toString(16))
    const desc = buf[off + 4]
    const fcsFlag = desc >> 6
    const singleSegment = (desc >> 5) & 1
    const checksum = (desc >> 2) & 1
    const dictFlag = desc & 3
    let p = off + 5
    if (!singleSegment) p += 1
    const dictSize = [0, 1, 2, 4][dictFlag]
    p += dictSize
    const fcsSize = fcsFlag === 0 ? (singleSegment ? 1 : 0) : (1 << fcsFlag)
    p += fcsSize
    if (p > buf.length) throw new Error('truncated header at ' + off)
    for (;;) {
      if (p + 3 > buf.length) throw new Error('truncated block header at ' + p)
      const h = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16)
      p += 3
      const last = h & 1
      const type = (h >> 1) & 3
      const size = h >> 3
      if (type === 3) throw new Error('reserved block type at ' + p)
      const stored = type === 1 ? 1 : size
      p += stored
      if (p > buf.length) throw new Error('truncated block at ' + p)
      if (last) break
    }
    if (checksum) p += 4
    if (p > buf.length) throw new Error('truncated checksum/frame end at ' + p)
    out.push(zstdDecompressSync(buf.subarray(off, p)))
    frames++
    off = p
  }
  return { text: Buffer.concat(out).toString('utf8'), frames, bytes: off }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2]
  const buf = readFileSync(file)
  const { text, frames, bytes } = zstdDecodeAll(buf)
  const lines = text.split('\n').filter(Boolean)
  console.log('file bytes', buf.length, 'frames', frames, 'consumed', bytes, 'lines', lines.length)
  const types = new Map()
  let header
  for (const line of lines) {
    let o
    try { o = JSON.parse(line) } catch { console.log('BAD LINE', line.slice(0, 120)); continue }
    if (!header && o.type === 'session') { header = o; continue }
    types.set(o.type, (types.get(o.type) ?? 0) + 1)
  }
  console.log('header keys:', header && Object.keys(header))
  console.log('header:', JSON.stringify(header).slice(0, 500))
  console.log('types:', JSON.stringify([...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)))
}
