import { json, err } from '../lib/response'
import { getPageContent, getReleaseAsset, downloadReleaseAsset } from '../lib/github'
import { HASH_REGEX } from '../../shared/constants'
import type { Router } from '../lib/router'
import type { Env } from '../lib/types'

interface BookEntry { h: string; t: string; a: string; c: number; p: number; d: string; tag: string; i: number }

let indexCache: { books: BookEntry[]; ts: number } | null = null
const INDEX_TTL = 60_000
const ASSET_TTL = 86400
const HASH_PARAM = { hash: { type: 'string' as const, description: '书籍 hash（12位hex）', pattern: '^[a-f0-9]{12}$', example: 'a1b2c3d4e5f6' } }

const BookEntrySchema = {
  type: 'object' as const,
  properties: {
    h: { type: 'string', description: '书籍内容 hash', example: 'a1b2c3d4e5f6' },
    t: { type: 'string', description: '书名', example: '三体' },
    a: { type: 'string', description: '作者', example: '刘慈欣' },
    c: { type: 'integer', description: '总章节数', example: 100 },
    p: { type: 'integer', description: 'Release 分片数', example: 3 },
    d: { type: 'string', format: 'date-time', description: '创建时间', example: '2026-07-14T17:55:22Z' },
    tag: { type: 'string', description: '首 Release tag', example: 'va1b2c3d4e5f60' },
  },
}

const BookDetailSchema = {
  type: 'object' as const,
  properties: {
    t: { type: 'string', description: '书名', example: '三体' },
    a: { type: 'string', description: '作者', example: '刘慈欣' },
    desc: { type: 'string', description: '简介', example: '这是一部科幻巨作...' },
    c: { type: 'integer', description: '总章节数', example: 100 },
    p: { type: 'integer', description: 'Release 分片数', example: 3 },
    d: { type: 'string', format: 'date-time', description: '创建时间', example: '2026-07-14T17:55:22Z' },
    i: { type: 'integer', description: '是否有封面（0/1）', example: 1 },
    tag: { type: 'string', description: '首 Release tag', example: 'va1b2c3d4e5f60' },
    releaseUrl: { type: 'string', description: 'Release 页面 URL', example: 'https://github.com/user/content/releases/tag/va1b2c3d4e5f60' },
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
  tag: string, assetName: string, contentType: string,
): Promise<Response> {
  const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
  const cache = caches.default
  const cached = await cache.match(request)
  if (cached) return cached
  const asset = await getReleaseAsset(CONTENT_OWNER, CONTENT_REPO, tag, assetName, GH_PAT)
  if (!asset) return err('NOT_FOUND', null, 404)
  const res = await downloadReleaseAsset(CONTENT_OWNER, CONTENT_REPO, asset.id, GH_PAT)
  if (!res.ok) return err('NOT_FOUND', null, 404)
  const headers = new Headers()
  headers.set('Content-Type', contentType)
  headers.set('Cache-Control', `public, max-age=${ASSET_TTL}, immutable`)
  const response = new Response(res.body, { status: res.status, headers })
  ctx.waitUntil(cache.put(request, response.clone()))
  return response
}

export function register(router: Router) {
  // ── 列表 / 搜索 ──

  router.get('/api/books', async (req, env) => {
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim().toLowerCase() || ''
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('size') || '50', 10)))

    const books = await getIndex(env)
    const filtered = q ? books.filter(b =>
      b.t.toLowerCase().includes(q) || b.a.toLowerCase().includes(q)) : books
    const total = filtered.length
    const start = (page - 1) * pageSize
    const result = filtered.slice(start, start + pageSize)

    return json({
      books: result,
      total,
      page,
      size: pageSize,
      totalPages: Math.ceil(total / pageSize),
    })
  }, {
    summary: '搜索/列出书籍',
    description: '获取全部书籍列表，通过 `q` 参数可按书名或作者搜索。响应设置 Cache-Control: max-age=60（索引缓存 60 秒）。',
    tags: ['Books'],
    query: {
      q: { description: '搜索关键词（可选）', example: '三体', required: false },
      page: { type: 'integer', description: '页码（默认 1）', required: false, example: 1 },
      size: { type: 'integer', description: '每页数量（默认 50，最大 100）', required: false, example: 20 },
    },
    responses: {
      '200': {
        description: '书籍列表（含分页信息）',
        content: {
          schema: {
            type: 'object',
            properties: {
              books: { type: 'array', items: BookEntrySchema },
              total: { type: 'integer', description: '总数' },
              page: { type: 'integer' },
              size: { type: 'integer' },
              totalPages: { type: 'integer' },
            },
          },
        },
      },
    },
  })

  // ── 详情 ──

  router.get('/api/books/:hash', async (_req, env, _ctx, params) => {
    const hash = params.hash
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
    if (!CONTENT_OWNER || !CONTENT_REPO || !GH_PAT) return err('GITHUB_ERROR', null, 500)

    const detail = await fetchDetail(env, hash)
    if (!detail) return err('NOT_FOUND', '未找到该书籍', 404)

    const tag = `v${hash}0`
    return json({
      t: detail.t,
      a: detail.a,
      desc: detail.desc || '',
      c: detail.c,
      p: detail.p,
      d: detail.d,
      i: detail.i ?? 0,
      tag,
      releaseUrl: `https://github.com/${CONTENT_OWNER}/${CONTENT_REPO}/releases/tag/${tag}`,
    })
  }, {
    summary: '获取书籍详情',
    description: '返回书籍的完整元数据（不含目录），从 Release 中读取 detail.json。',
    tags: ['Books'],
    params: HASH_PARAM,
    responses: {
      '200': { description: '书籍详情（含 releaseUrl）', content: { schema: BookDetailSchema } },
      '404': { description: '[NOT_FOUND] 未找到该书籍' },
    },
  })

  // ── 详情文件辅助 ──

  async function fetchDetail(env: Env, hash: string): Promise<any> {
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
    const tag = `v${hash}0`
    const asset = await getReleaseAsset(CONTENT_OWNER, CONTENT_REPO, tag, 'detail.json', GH_PAT)
    if (!asset) return null
    const res = await downloadReleaseAsset(CONTENT_OWNER, CONTENT_REPO, asset.id, GH_PAT)
    if (!res.ok) return null
    return res.json()
  }

  function cachedJsonResponse(data: any, req: Request, ctx: ExecutionContext): Response {
    const cache = caches.default
    const body = JSON.stringify(data)
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ASSET_TTL}`
    })
    const response = new Response(body, { headers })
    ctx.waitUntil(cache.put(req, response.clone()))
    return response
  }

  // ── 简介 ──

  router.get('/api/books/:hash/desc', async (req, env, ctx, params) => {
    const hash = params.hash
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    const detail = await fetchDetail(env, hash)
    if (!detail) return err('NOT_FOUND', null, 404)
    return cachedJsonResponse({ desc: detail.desc || '' }, req, ctx)
  }, {
    summary: '获取书籍简介',
    description: '返回书籍简介，缓存 24 小时。',
    tags: ['Books'],
    params: HASH_PARAM,
    responses: {
      '200': { description: '简介', content: { schema: { type: 'object', properties: { desc: { type: 'string', example: '这是一部科幻小说...' } } } } },
      '404': { description: '[NOT_FOUND] 未找到' },
    },
  })

  // ── 目录 ──

  router.get('/api/books/:hash/toc', async (req, env, ctx, params) => {
    const hash = params.hash
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    const detail = await fetchDetail(env, hash)
    if (!detail) return err('NOT_FOUND', null, 404)
    return cachedJsonResponse(detail.toc || [], req, ctx)
  }, {
    summary: '获取书籍目录',
    description: '返回书籍的完整目录结构，缓存 24 小时。',
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
                k: { type: 'string', description: '章节 key', example: '00a1b2c3d4e5f6' },
                t: { type: 'string', description: '章节标题', example: '第一章 初见' },
                l: { type: 'integer', description: '层级', example: 0 },
              },
            },
          },
        },
      },
      '404': { description: '[NOT_FOUND] 未找到' },
    },
  })

  // ── 详情（简介+目录） ──

  router.get('/api/books/:hash/detail', async (req, env, ctx, params) => {
    const hash = params.hash
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    const detail = await fetchDetail(env, hash)
    if (!detail) return err('NOT_FOUND', null, 404)
    return cachedJsonResponse({ desc: detail.desc || '', toc: detail.toc || [] }, req, ctx)
  }, {
    summary: '获取书籍简介及目录',
    description: '返回书籍简介和完整目录，缓存 24 小时。',
    tags: ['Books'],
    params: HASH_PARAM,
    responses: {
      '200': { description: '简介与目录', content: { schema: { type: 'object', properties: { desc: { type: 'string' }, toc: { type: 'array' } } } } },
      '404': { description: '[NOT_FOUND] 未找到' },
    },
  })

  // ── 封面 ──

  router.get('/api/books/:hash/cover', async (req, env, ctx, params) => {
    const hash = params.hash
    if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)
    return proxyAsset(env, req, ctx, `v${hash}0`, 'cover.jpg', 'image/jpeg')
  }, {
    summary: '获取书籍封面',
    description: '返回 JPEG 封面图（Content-Type: image/jpeg），缓存 24 小时。',
    tags: ['Books'],
    params: HASH_PARAM,
    responses: { '200': { description: 'JPEG 图片' } },
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
    description: '返回章节正文（content 字段为纯文本），缓存 24 小时。`key` 由目录接口中的 `k` 字段提供。',
    tags: ['Books'],
    params: {
      hash: { ...HASH_PARAM.hash },
      key: { type: 'string', description: '章节 key（见目录接口 k 字段）', example: '00b1c2d3e4f5a', minLength: 13 },
    },
    responses: {
      '200': {
        description: '章节内容（content 为纯文本）',
        content: {
          schema: {
            type: 'object',
            properties: { content: { type: 'string', description: '章节纯文本正文', example: '第一章内容...' } },
          },
        },
      },
      '404': { description: '[NOT_FOUND] 未找到' },
    },
  })
}
