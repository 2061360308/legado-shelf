import { AwsClient } from 'aws4fetch'
import { Octokit } from '@octokit/rest'
import JSZip from 'jszip'
import { Buffer } from 'node:buffer'

/* ── 环境变量 ───────────────────────────────── */
const R2_ENDPOINT     = required('R2_ENDPOINT')
const R2_KEY_ID       = required('R2_ACCESS_KEY_ID')
const R2_SECRET       = required('R2_SECRET_ACCESS_KEY')
const R2_BUCKET       = required('R2_BUCKET_NAME')
const GITHUB_TOKEN    = required('GH_PAT')
const CONTENT_OWNER   = required('CONTENT_OWNER')
const CONTENT_REPO    = required('CONTENT_REPO')
const INPUT_HASH      = process.env.INPUT_HASH || ''
const UPLOAD_PREFIX   = 'uploads/'
const INDEX_PATH      = 'index.json'

function required(name) {
  const v = process.env[name]
  if (!v) { console.error(`❌ 缺少环境变量 ${name}`); process.exit(1) }
  return v
}

/* ── 客户端 ─────────────────────────────────── */
const r2 = new AwsClient({
  accessKeyId: R2_KEY_ID,
  secretAccessKey: R2_SECRET,
  service: 's3',
  region: 'auto',
})

const octo = new Octokit({ auth: GITHUB_TOKEN })

const HOSTNAME = new URL(R2_ENDPOINT).hostname

/* ── R2 操作 ────────────────────────────────── */

async function listUploads() {
  const url = `https://${HOSTNAME}/${R2_BUCKET}?list-type=2&prefix=${encodeURIComponent(UPLOAD_PREFIX)}`
  const res = await r2.fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`R2 list 失败: ${res.status}`)
  const xml = await res.text()

  const keys = []
  const re = /<Key>([^<]+)<\/Key>/g
  let m
  while ((m = re.exec(xml)) !== null) {
    if (m[1].endsWith('.zip')) keys.push(m[1])
  }
  return keys
}

async function downloadZip(key) {
  const url = `https://${HOSTNAME}/${R2_BUCKET}/${key}`
  const res = await r2.fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`下载 ${key} 失败: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/* ── GitHub 操作 ────────────────────────────── */

async function releaseExists(tag) {
  try {
    await octo.rest.repos.getReleaseByTag({ owner: CONTENT_OWNER, repo: CONTENT_REPO, tag })
    return true
  } catch (e) {
    if (e.status === 404) return false
    throw e
  }
}

async function createRelease(tag, name, body) {
  const { data } = await octo.rest.repos.createRelease({
    owner: CONTENT_OWNER, repo: CONTENT_REPO, tag_name: tag, name, body,
    draft: false, prerelease: false,
  })
  return data
}

async function uploadAsset(uploadUrl, assetName, data, contentType) {
  const url = uploadUrl.replace('{?name,label}', `?name=${encodeURIComponent(assetName)}`)
  await octo.request({ method: 'POST', url, headers: { 'content-type': contentType }, data })
}

/* ── 索引文件 ───────────────────────────────── */

async function readIndex() {
  try {
    const { data } = await octo.rest.repos.getContent({ owner: CONTENT_OWNER, repo: CONTENT_REPO, path: INDEX_PATH })
    const content = Buffer.from(data.content, 'base64').toString('utf-8')
    return { books: JSON.parse(content).books, sha: data.sha }
  } catch (e) {
    if (e.status === 404) return { books: [], sha: null }
    throw e
  }
}

async function writeIndex(books, sha) {
  const content = Buffer.from(JSON.stringify({ books }, null, 2) + '\n', 'utf-8').toString('base64')
  const params = { owner: CONTENT_OWNER, repo: CONTENT_REPO, path: INDEX_PATH, message: '📚 更新书籍索引', content }
  if (sha) params.sha = sha
  await octo.rest.repos.createOrUpdateFileContents(params)
}

/* ── ZIP 处理 ───────────────────────────────── */

const SHORT_HASH_LEN = 12

function keyInfo(key) {
  const base = key.replace(UPLOAD_PREFIX, '').replace(/\.zip$/, '')
  const idx = base.indexOf('_')
  const hash = idx === -1 ? base : base.substring(0, idx)
  const title = idx === -1 ? '' : base.substring(idx + 1)
  return { hash, title }
}

async function processZip(key) {
  const { hash, title } = keyInfo(key)
  const tag0 = `v${hash}0`

  if (await releaseExists(tag0)) {
    console.log(`  ⏭ ${key} → release 已存在`)
    return null
  }

  console.log(`\n📥 ${key}`)
  const zipBuf = await downloadZip(key)
  const zip = await JSZip.loadAsync(zipBuf)

  const meta = JSON.parse(await zip.file('metadata.json').async('string'))
  const bookTitle = meta.t || title || '未命名'
  const author = meta.a || '未知'
  const totalChapters = meta.c || 0

  const tocRaw = zip.file('toc.json')
  const toc = tocRaw ? JSON.parse(await tocRaw.async('string')) : []
  const tocBuf = tocRaw ? await tocRaw.async('nodebuffer') : null

  const coverBuf = zip.file('cover.jpg') ? await zip.file('cover.jpg').async('nodebuffer') : null

  const parts = new Map()
  for (const e of toc) {
    const k = e.k
    const chHash = k.substring(k.length - SHORT_HASH_LEN)
    const p = parseInt(k.substring(0, k.length - SHORT_HASH_LEN), 10) || 0
    if (!parts.has(p)) parts.set(p, [])
    parts.get(p).push({ ...e, chHash })
  }
  const partIndices = [...parts.keys()].sort((a, b) => a - b)
  if (partIndices.length === 0) partIndices.push(0)

  let firstTag = tag0

  for (const p of partIndices) {
    const tag = `v${hash}${p}`
    if (p === 0) firstTag = tag

    const body = [
      `**${bookTitle}**`,
      author !== '未知' ? `作者: ${author}` : '',
      `总章节: ${totalChapters}`,
      `Part: ${p}`,
      `Hash: \`${hash}\``,
    ].filter(Boolean).join('\n')

    const release = await createRelease(tag, `${bookTitle} (Part ${p})`, body)
    const entries = parts.get(p) || []
    let count = 0

    if (p === 0 && coverBuf) {
      await uploadAsset(release.upload_url, 'cover.jpg', coverBuf, 'image/jpeg')
      count++
    }
    if (p === 0 && tocBuf) {
      await uploadAsset(release.upload_url, 'toc.json', tocBuf, 'application/json')
      count++
    }

    for (const e of entries) {
      const file = zip.file(`chapters/${e.chHash}.txt`) || zip.file(`chapters/${e.chHash}.md`)
      if (file) {
        await uploadAsset(release.upload_url, `${e.k}.txt`, await file.async('nodebuffer'), 'text/plain; charset=utf-8')
        count++
      }
    }

    console.log(`  ✅ ${tag} — ${count} 个资源 → ${release.html_url}`)
  }

  return {
    hash, title: bookTitle, author, chapters: totalChapters,
    parts: partIndices.length, createdAt: meta.d, tag: firstTag,
  }
}

/* ── 主流程 ─────────────────────────────────── */

async function main() {
  console.log('🔍 列出 R2 上传文件...')
  const keys = await listUploads()
  console.log(`  ${keys.length} 个 ZIP`)

  let targets = keys
  if (INPUT_HASH) {
    targets = keys.filter(k => k.includes(INPUT_HASH))
    if (targets.length === 0) { console.log(`❌ 未找到 hash=${INPUT_HASH}`); process.exit(1) }
    console.log(`🎯 指定: ${targets[0]}`)
  }

  const results = []
  let ok = 0, skip = 0, fail = 0

  for (const key of targets) {
    try {
      const r = await processZip(key)
      if (r) { results.push(r); ok++ }
      else { skip++ }
    } catch (e) {
      console.error(`  ❌ ${key}:`, e.message)
      fail++
    }
  }

  console.log(`\n📊 处理=${ok} 跳过=${skip} 失败=${fail}`)

  if (results.length > 0) {
    console.log('\n📚 更新索引...')
    const { books, sha } = await readIndex()
    const map = new Map(books.map(b => [b.h, b]))
    for (const r of results) {
      map.set(r.hash, { h: r.hash, t: r.title, a: r.author, c: r.chapters, p: r.parts, d: r.createdAt, tag: r.tag })
    }
    await writeIndex([...map.values()], sha)
    console.log('  ✅ index.json 已更新')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
