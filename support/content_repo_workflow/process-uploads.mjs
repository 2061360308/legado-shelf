import { Buffer } from 'node:buffer'
import JSZip from 'jszip'

import { createR2Client, r2Key, keyInfo, listObjects, downloadObject, deleteObject } from '../../shared/r2'
import { createOctokit, releaseExists, createRelease, readFile, writeFile, uploadAssets, deleteReleaseByTag } from '../../shared/github'
import { UPLOAD_PREFIX } from '../../shared/constants'

/* ── 环境变量 ───────────────────────────────── */
const R2_ENDPOINT     = required('R2_ENDPOINT')
const R2_KEY_ID       = required('R2_ACCESS_KEY_ID')
const R2_SECRET       = required('R2_SECRET_ACCESS_KEY')
const R2_BUCKET       = required('R2_BUCKET_NAME')
const GITHUB_TOKEN    = required('GITHUB_TOKEN')
const GH_REPO         = process.env.GITHUB_REPOSITORY || ''
const [GH_OWNER = '', GH_NAME = ''] = GH_REPO.split('/')
const INDEX_PATH      = 'index.json'

function required(name) {
  const v = process.env[name]
  if (!v) { console.error(`❌ 缺少环境变量 ${name}`); process.exit(1) }
  return v
}

/* ── 客户端 ─────────────────────────────────── */
const { client: r2, hostname } = createR2Client({
  endpoint: R2_ENDPOINT,
  accessKeyId: R2_KEY_ID,
  secretAccessKey: R2_SECRET,
  bucket: R2_BUCKET,
})

const octo = createOctokit(GITHUB_TOKEN)

/* ── 常量 ───────────────────────────────────── */
const CHAPTERS_PER_PART = 990
const SHORT_HASH_LEN = 12

/* ── 索引文件 ───────────────────────────────── */

async function readIndex() {
  const result = await readFile(octo, GH_OWNER, GH_NAME, INDEX_PATH)
  if (!result) return { books: [], sha: null }
  return { books: JSON.parse(result.content).books, sha: result.sha }
}

async function saveIndex(books, sha) {
  const content = JSON.stringify({ books }, null, 2) + '\n'
  await writeFile(octo, GH_OWNER, GH_NAME, INDEX_PATH, content, '📚 更新书籍索引', sha ?? undefined)
}

/* ── ZIP 处理 ───────────────────────────────── */

async function processZip(key) {
  const { hash, title } = keyInfo(key)
  const tag0 = `v${hash}0`

  if (await releaseExists(octo, GH_OWNER, GH_NAME, tag0)) {
    console.log(`  ⏭ ${key} → release 已存在`)
    return null
  }

  console.log(`\n📥 ${key}`)
  const zipBuf = Buffer.from(await downloadObject(r2, hostname, R2_BUCKET, key))
  const zip = await JSZip.loadAsync(zipBuf)

  const detailRaw = zip.file('detail.json')
  const detail = detailRaw ? JSON.parse(await detailRaw.async('string')) : null
  if (!detail) throw new Error('detail.json 缺失')

  const bookTitle = detail.t || title || '未命名'
  const author = detail.a || '未知'
  const totalChapters = detail.c || 0
  const createdAt = detail.d || ''
  const hasCover = detail.i ?? 0
  const toc = detail.toc || []

  // 按 TOC 顺序分配 part，重写 k = partIdx + chShort
  const totalParts = Math.max(1, Math.floor((toc.length - 1) / CHAPTERS_PER_PART) + 1)
  const parts = new Map()
  for (let i = 0; i < toc.length; i++) {
    const e = toc[i]
    const partIdx = Math.floor(i / CHAPTERS_PER_PART)
    const chShort = e.k // packer 存的即是短 hash
    const newKey = `${partIdx}${chShort}`
    e.k = newKey
    if (!parts.has(partIdx)) parts.set(partIdx, [])
    parts.get(partIdx).push({ ...e, chShort })
  }

  // 更新 detail.json 并重新序列化
  detail.p = totalParts
  detail.toc = toc
  const detailBuf = Buffer.from(JSON.stringify(detail), 'utf-8')

  const coverBuf = zip.file('cover.jpg') ? await zip.file('cover.jpg').async('nodebuffer') : null

  let firstTag = tag0
  const createdTags = []

  const partIndices = [...parts.keys()].sort((a, b) => a - b)

  for (const p of partIndices) {
    const tag = `v${hash}${p}`
    if (p === 0) firstTag = tag
    createdTags.push(tag)

    const body = [
      `**${bookTitle}**`,
      author !== '未知' ? `作者: ${author}` : '',
      `总章节: ${totalChapters}`,
      `Part: ${p}`,
      `Hash: \`${hash}\``,
    ].filter(Boolean).join('\n')

    const release = await createRelease(octo, GH_OWNER, GH_NAME, tag, `${bookTitle} (Part ${p})`, body)
    const entries = parts.get(p) || []
    let count = 0

    if (p === 0 && zipBuf) {
      await uploadAssets(octo, release.upload_url, [{ name: 'res.zip', data: zipBuf, type: 'application/zip' }])
      count++
    }
    if (p === 0 && coverBuf) {
      await uploadAssets(octo, release.upload_url, [{ name: 'cover.jpg', data: coverBuf, type: 'image/jpeg' }])
      count++
    }
    if (p === 0 && detailBuf) {
      await uploadAssets(octo, release.upload_url, [{ name: 'detail.json', data: detailBuf, type: 'application/json' }])
      count++
    }

    const chapterAssets = []
    for (const e of entries) {
      const file = zip.file(`chapters/${e.chShort}.txt`) || zip.file(`chapters/${e.chShort}.md`)
      if (file) {
        chapterAssets.push({
          name: `${e.k}.txt`,
          data: await file.async('nodebuffer'),
          type: 'text/plain; charset=utf-8',
        })
      }
    }
    await uploadAssets(octo, release.upload_url, chapterAssets)
    count += chapterAssets.length

    console.log(`  ✅ ${tag} — ${count} 个资源 → ${release.html_url}`)
  }

  return {
    hash, title: bookTitle, author, chapters: totalChapters,
    parts: totalParts, createdAt, tag: firstTag, i: hasCover,
    tags: createdTags,
  }
}

/* ── 主流程 ─────────────────────────────────── */

async function main() {
  console.log('🔍 列出 R2 上传文件...')
  const keys = await listObjects(r2, hostname, R2_BUCKET, UPLOAD_PREFIX)
  console.log(`  ${keys.length} 个 ZIP`)

  const results = []
  let ok = 0, skip = 0, fail = 0

  for (const key of keys) {
    try {
      const r = await processZip(key)
      if (r) { results.push(r); ok++ }
      else { skip++; await deleteObject(r2, hostname, R2_BUCKET, key) }
    } catch (e) {
      console.error(`  ❌ ${key}:`, e.message)
      fail++
    }
  }

  console.log(`\n📊 处理=${ok} 跳过=${skip} 失败=${fail}`)

  if (results.length > 0) {
    console.log('\n📚 更新索引...')
    try {
      const { books, sha } = await readIndex()
      const map = new Map(books.map(b => [b.h, b]))
      for (const r of results) {
        map.set(r.hash, { h: r.hash, t: r.title, a: r.author, c: r.chapters, p: r.parts, d: r.createdAt, tag: r.tag, i: r.i })
      }
      await saveIndex([...map.values()], sha)
      console.log('  ✅ index.json 已更新')
      for (const r of results) {
        await deleteObject(r2, hostname, R2_BUCKET, r2Key(r.hash, r.title))
      }
    } catch (e) {
      console.error('\n❌ 索引更新失败，回滚已创建的 Release...')
      console.error(`  ${e.message}`)
      for (const r of results) {
        for (const tag of r.tags) {
          console.log(`  🗑 删除 ${tag}`)
          await deleteReleaseByTag(octo, GH_OWNER, GH_NAME, tag)
        }
      }
      throw e
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
