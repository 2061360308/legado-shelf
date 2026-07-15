import JSZip from 'jszip'
import { requestPresign, uploadToR2 } from './api'
import { sha256Buffer } from './utils'
import { SHORT_HASH_LEN } from './constants'
import type { NovelData } from './parser'

const short = (h: string) => h.substring(0, SHORT_HASH_LEN)

function sanitizeName(s: string): string {
  return s.replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 64) || 'novel'
}

async function convertCoverToJpeg(dataUrl: string): Promise<{ jpeg: ArrayBuffer, hash: string } | null> {
  const img = new Image()
  img.src = dataUrl
  try { await img.decode() } catch { return null }
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('JPEG encoding failed')), 'image/jpeg', 0.85))
  const buf = await blob.arrayBuffer()
  const hash = await sha256Buffer(buf)
  return { jpeg: buf, hash }
}

const CHAPTERS_PER_PART = 998
const ITEMS_PER_PART = 1000

function partIndex(chapterIdx: number): number {
  if (chapterIdx < CHAPTERS_PER_PART) return 0
  return 1 + Math.floor((chapterIdx - CHAPTERS_PER_PART) / ITEMS_PER_PART)
}

export async function packageZip(novel: NovelData): Promise<Blob> {
  const zip = new JSZip()

  zip.file('metadata.json', JSON.stringify({
    v: 1,
    t: novel.title,
    a: novel.author,
    g: novel.contentHash,
    c: novel.chapters.length,
    d: new Date().toISOString(),
  }))

  if (novel.cover) {
    const c = await convertCoverToJpeg(novel.cover)
    if (c) {
      zip.file('cover.jpg', c.jpeg)
    }
  }

  const toc: { k: string, t: string, l: number }[] = []
  const cf = zip.folder('chapters')!
  for (let i = 0; i < novel.chapters.length; i++) {
    const ch = novel.chapters[i]!
    const chShort = short(ch.hash)
    const key = `${partIndex(i)}${chShort}`
    toc.push({ k: key, t: ch.title, l: ch.level || 1 })
    cf.file(`${chShort}.txt`, ch.body)
  }
  zip.file('toc.json', JSON.stringify(toc))

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export async function fullUpload(
  novel: NovelData,
  onProgress?: (p: number) => void,
): Promise<{ hash: string }> {
  const blob = await packageZip(novel)
  const title = sanitizeName(novel.title)
  const presign = await requestPresign(novel.contentHash, blob.size, title)

  onProgress?.(0)
  await uploadToR2(presign.url, blob, p => onProgress?.(p))

  return { hash: novel.contentHash }
}
