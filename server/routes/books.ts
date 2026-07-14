import { json, err } from '../lib/response'
import { getPageContent, getReleaseAsset, downloadReleaseAsset, checkReleaseExists, listReleaseTags } from '../lib/github'
import { HASH_REGEX } from '../../shared/constants'
import type { Router } from '../lib/router'
import type { Env } from '../lib/types'

interface BookEntry { h: string; t: string; a: string; c: number; p: number; d: string; tag: string }

let indexCache: { books: BookEntry[]; ts: number } | null = null
const INDEX_TTL = 60_000
const ASSET_TTL = 86400
const HASH_PARAM = { hash: { type: 'string' as const, description: '书籍 hash（12位hex）', pattern: '^[a-f0-9]{12}$', example: 'a1b2c3d4e5f6' } }

const BookEntrySchema = {
  type: 'object' as const,
  properties: {
    h: { type: 'string', description: '书籍 hash', example: 'a1b2c3d4e5f6' },
    t: { type: 'string', description: '书名', example: '三体' },
    a: { type: 'string', description: '作者', example: '刘慈欣' },
    c: { type: 'integer', description: '章节数', example: 100 },
    p: { type: 'integer', description: '分片数', example: 3 },
    d: { type: 'string', format: 'date-time', description: '创建时间', example: '2026-07-14T17:55:22Z' },
    tag: { type: 'string', description: '首 Release tag', example: 'va1b2c3d4e5f60' },
  },
}

async function getIndex(env: Env): Promise<BookEntry[]> {
  if (indexCache && Date.now() - indexCache.ts < INDEX_TTL) return indexCache.books
  const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
  const raw = await getPageContent(CONTENT_OWNER, CONTENT_REPO, 'index.json', GH_PAT)
  const books = raw ? JSON.parse(raw).books || [] : []
  indexCache = { books, ts: Date.now() }
  return books
}

async function proxyAsset(
  env: Env, request: Request, ctx: ExecutionContext,
  tag: string, assetName: string,
): Promise<Response> {
  const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
  const cache = caches.default
  const cached = await cache.match(request)
  if (cached) return cached
  const asset = await getReleaseAsset(CONTENT_OWNER, CONTENT_REPO, tag, assetName, GH_PAT)
  if (!asset) return err('NOT_FOUND', null, 404)
  const res = await downloadReleaseAsset(CONTENT_OWNER, CONTENT_REPO, asset.id, GH_PAT)
  if (!res.ok) return err('NOT_FOUND', null, 404)
  const headers = new Headers(res.headers)
  headers.set('Cache-Control', `public, max-age=${ASSET_TTL}, immutable`)
  const response = new Response(res.body, { status: res.status, headers })
  ctx.waitUntil(cache.put(request, response.clone()))
  return response
}

export function register(router: Router) {
  // ── 列表 / 搜索 ──

  router.get('/api/books', async (req, env) => {
    const q = new URL(req.url).searchParams.get('q')?.trim().toLowerCase() || ''
    const books = await getIndex(env)
    const result = q ? books.filter(b =>
      b.t.toLowerCase().includes(q) || b.a.toLowerCase().includes(q)) : books
    return json({ books: result })
  }, {
    summary: '搜索/列出书籍',
    description: '获取全部书籍列表，通过 `q` 参数可按书名或作者搜索。',
    tags: ['Books'],
    query: { q: { description: '搜索关键词（可选）', example: '三体', required: false } },
    responses: {
      '200': {
        description: '书籍列表',
        content: {
          schema: {
            type: 'object',
            properties: { books: { type: 'array', items: BookEntrySchema } },
          },
        },
      },
    },
  })

  // ── 详情 / 发布检查 ──

  router.get('/api/books/:hash', async (_req, env, _ctx, params) => {
    const hash = params.hash
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
    if (!CONTENT_OWNER || !CONTENT_REPO || !GH_PAT) return err('GITHUB_ERROR', null, 500)

    const books = await getIndex(env)
    const book = books.find(b => b.h === hash)
    if (book) {
      const tags = await listReleaseTags(CONTENT_OWNER, CONTENT_REPO, hash, GH_PAT)
      const tag0 = `v${hash}0`
      const release = await checkReleaseExists(CONTENT_OWNER, CONTENT_REPO, tag0, GH_PAT)
      return json({ ...book, tags, releaseUrl: release?.htmlUrl ?? '' })
    }

    const tag0 = `v${hash}0`
    const release = await checkReleaseExists(CONTENT_OWNER, CONTENT_REPO, tag0, GH_PAT)
    if (!release) return json({ exists: false })
    const tags = await listReleaseTags(CONTENT_OWNER, CONTENT_REPO, hash, GH_PAT)
    return json({ exists: true, guri: `urn:novel:sha256:${hash}`, tags, releaseUrl: release.htmlUrl })
  }, {
    summary: '获取书籍详情/检查发布状态',
    description: '从索引中查找书籍，若未收录则检查 Release 是否存在。',
    tags: ['Books'],
    params: HASH_PARAM,
    responses: {
      '200': { description: '书籍元数据（含 tags/releaseUrl）或 { exists: false }', content: { schema: { type: 'object' } } },
    },
  })

  // ── 目录 ──

  router.get('/api/books/:hash/toc', async (req, env, ctx, params) => {
    const hash = params.hash
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
    const cache = caches.default
    const cached = await cache.match(req)
    if (cached) return cached
    const tag = `v${hash}0`
    const asset = await getReleaseAsset(CONTENT_OWNER, CONTENT_REPO, tag, 'toc.json', GH_PAT)
    if (!asset) return err('NOT_FOUND', null, 404)
    const res = await downloadReleaseAsset(CONTENT_OWNER, CONTENT_REPO, asset.id, GH_PAT)
    if (!res.ok) return err('NOT_FOUND', null, 404)
    const toc = await res.json()
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ASSET_TTL}`
    })
    const response = new Response(JSON.stringify(toc), { headers })
    ctx.waitUntil(cache.put(req, response.clone()))
    return response
  }, {
    summary: '获取书籍目录',
    description: '返回书籍的完整目录结构（TOC），缓存 24 小时。',
    tags: ['Books'],
    params: HASH_PARAM,
    responses: {
      '200': {
        description: '目录数据',
        content: {
          schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                k: { type: 'string', description: '章节 key', example: '0123456789ab' },
                t: { type: 'string', description: '章节标题', example: '第一章 初见' },
                l: { type: 'integer', description: '层级', example: 0 },
              },
            },
          },
        },
      },
    },
  })

  // ── 封面 ──

  router.get('/api/books/:hash/cover', async (req, env, ctx, params) => {
    const hash = params.hash
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    return proxyAsset(env, req, ctx, `v${hash}0`, 'cover.jpg')
  }, {
    summary: '获取书籍封面',
    description: '返回 JPEG 封面图，缓存 24 小时。',
    tags: ['Books'],
    params: HASH_PARAM,
    responses: { '200': { description: 'JPEG 图片', content: { schema: { type: 'string', example: '' } } } },
  })

  // ── 章节 ──

  router.get('/api/books/:hash/chapters/:key', async (req, env, ctx, params) => {
    const hash = params.hash
    const chKey = params.key
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    const chHashLen = 12
    const partStr = chKey.substring(0, chKey.length - chHashLen)
    const partIdx = partStr ? parseInt(partStr, 10) : 0
    const tag = `v${hash}${partIdx}`
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
    const cache = caches.default
    const cached = await cache.match(req)
    if (cached) return cached
    const asset = await getReleaseAsset(CONTENT_OWNER, CONTENT_REPO, tag, `${chKey}.txt`, GH_PAT)
    if (!asset) return err('NOT_FOUND', null, 404)
    const res = await downloadReleaseAsset(CONTENT_OWNER, CONTENT_REPO, asset.id, GH_PAT)
    if (!res.ok) return err('NOT_FOUND', null, 404)
    const text = await res.text()
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ASSET_TTL}, immutable`
    })
    const response = new Response(JSON.stringify({ content: text }), { headers })
    ctx.waitUntil(cache.put(req, response.clone()))
    return response
  }, {
    summary: '获取章节内容',
    description: '返回章节正文，缓存 24 小时。`key` 由目录接口中的 `k` 字段提供。',
    tags: ['Books'],
    params: {
      hash: { ...HASH_PARAM.hash },
      key: { type: 'string', description: '章节 key（见目录接口 k 字段）', example: '0b1c2d3e4f5a', minLength: 13 },
    },
    responses: {
      '200': {
        description: '章节内容',
        content: {
          schema: {
            type: 'object',
            properties: { content: { type: 'string', description: '章节正文', example: '第一章内容...' } },
          },
        },
      },
    },
  })
}
