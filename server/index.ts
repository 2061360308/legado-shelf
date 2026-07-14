import { json, err } from './_utils';
import { validateRequest } from '../lib/server/auth';
import { isActionRunning } from '../lib/server/action';
import { createR2Client, createPresignedUrl } from '../lib/server/presign';
import { r2Key, fileExists, listFiles, deleteFile } from '../lib/server/r2';
import { checkReleaseExists, listReleaseTags, triggerWorkflow, getPageContent, getReleaseAsset, downloadReleaseAsset } from '../lib/server/github';
import { HASH_REGEX, UPLOAD_PREFIX, PRESIGN_EXPIRES } from '../lib/shared/constants';
import type { Env } from '../lib/server/types';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const u = new URL(request.url);
    const p = u.pathname;
    const m = request.method;

    try {
      if (p === '/api/queue') {
        if (m === 'GET') return handleQueueList(env, request);
      }
      if (p.startsWith('/api/queue/') && m === 'DELETE') {
        return handleQueueDelete(env, request, p);
      }
      if (p === '/api/trigger' && m === 'POST') {
        return handleTrigger(env, request);
      }
      if (p === '/api/upload/presign' && m === 'POST') {
        return handlePresign(env, request);
      }
      if (p === '/api/upload/complete' && m === 'POST') {
        return handleComplete(env, request);
      }
      if (p === '/api/books' && m === 'GET') {
        return handleBooksList(env, request);
      }
      if (p.startsWith('/api/books/')) {
        return handleBooksRoute(env, request, p, ctx);
      }
      if (p.startsWith('/api/novel/')) {
        return handleNovelCheck(env, request, p);
      }
    } catch (e) {
      console.error(e);
      return err('INTERNAL_ERROR', null, 500);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleQueueList(env: Env, request: Request) {
  if (!validateRequest(request, env)) return err('UNAUTHORIZED', null, 401);
  let running = false;
  try { running = await isActionRunning(env); } catch { /* */ }
  let files: { key: string; size: number; uploaded: string }[] = [];
  try { files = await listFiles(env); } catch (e) { console.error(e); }
  return json({ files, actionRunning: running });
}

async function handleQueueDelete(env: Env, request: Request, path: string) {
  if (!validateRequest(request, env)) return err('UNAUTHORIZED', null, 401);
  if (await isActionRunning(env)) return err('ACTION_RUNNING', null, 503);
  const key = decodeURIComponent(path.slice('/api/queue/'.length));
  if (!key.startsWith(UPLOAD_PREFIX)) return err('INVALID_REQUEST', null, 400);
  try {
    if (!(await fileExists(key, env))) return err('NOT_FOUND', null, 404);
    await deleteFile(key, env);
  } catch { return err('R2_ERROR', null, 500); }
  return json({ deleted: true, key });
}

async function handlePresign(env: Env, request: Request) {
  if (!validateRequest(request, env)) return err('UNAUTHORIZED', null, 401);
  let body: { hash?: string; size?: number; title?: string };
  try { body = await request.json(); } catch { return err('INVALID_REQUEST', null, 400); }
  const { hash, size, title } = body;
  if (typeof hash !== 'string' || !HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400);
  const maxSize = parseInt(env.MAX_UPLOAD_SIZE, 10) || 52428800;
  if (typeof size !== 'number' || size <= 0 || size > maxSize) return err('UPLOAD_TOO_LARGE', null, 400);
  if (await isActionRunning(env)) return err('ACTION_RUNNING', null, 503);

  const key = r2Key(hash, typeof title === 'string' ? title : undefined);
  const client = createR2Client(env);
  const { url } = await createPresignedUrl(client, env.R2_ENDPOINT, {
    bucket: env.R2_BUCKET_NAME,
    key,
    size,
    contentType: 'application/zip',
  });
  return json({ url, key, expiresIn: PRESIGN_EXPIRES });
}

async function handleComplete(env: Env, request: Request) {
  if (!validateRequest(request, env)) return err('UNAUTHORIZED', null, 401);
  let body: { hash?: string; title?: string };
  try { body = await request.json(); } catch { return err('INVALID_REQUEST', null, 400); }
  const { hash, title } = body;
  if (typeof hash !== 'string' || !HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400);
  const key = r2Key(hash, typeof title === 'string' ? title : undefined);
  if (!(await fileExists(key, env))) return err('NOT_FOUND', null, 404);
  if (await isActionRunning(env)) {
    return json({ status: 'queued', hash, message: '文件已接收，将在下一轮被处理' });
  }
  const { CONTENT_OWNER, CONTENT_REPO, GH_PAT, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env;
  let triggered = false;
  if (CONTENT_OWNER && CONTENT_REPO && GH_PAT) {
    triggered = await triggerWorkflow(CONTENT_OWNER, CONTENT_REPO, GH_PAT, { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME });
  }
  return json({ status: triggered ? 'processing' : 'queued', hash, message: triggered ? '处理已开始' : '文件已接收，等待下一轮 Cron 处理' });
}

async function handleTrigger(env: Env, request: Request) {
  if (!validateRequest(request, env)) return err('UNAUTHORIZED', null, 401);
  if (await isActionRunning(env)) return err('ACTION_RUNNING', null, 503);

  const { CONTENT_OWNER, CONTENT_REPO, GH_PAT, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env;
  if (!CONTENT_OWNER || !CONTENT_REPO || !GH_PAT) {
    return err('GITHUB_ERROR', null, 500);
  }

  const ok = await triggerWorkflow(CONTENT_OWNER, CONTENT_REPO, GH_PAT, { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME });
  return json({ triggered: ok });
}

async function handleNovelCheck(env: Env, request: Request, path: string) {
  if (!validateRequest(request, env)) return err('UNAUTHORIZED', null, 401);
  const hash = path.slice('/api/novel/'.length);
  if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400);
  const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env;
  if (!CONTENT_OWNER || !CONTENT_REPO || !GH_PAT) return err('GITHUB_ERROR', null, 500);
  const tag = `v${hash}0`;
  const release = await checkReleaseExists(CONTENT_OWNER, CONTENT_REPO, tag, GH_PAT);
  if (!release) return json({ exists: false });
  const tags = await listReleaseTags(CONTENT_OWNER, CONTENT_REPO, hash, GH_PAT);
  return json({ exists: true, guri: `urn:novel:sha256:${hash}`, tags, releaseUrl: release.htmlUrl });
}

/* ── 书籍 API ───────────────────────────────── */

interface BookEntry { h: string; t: string; a: string; c: number; p: number; d: string; tag: string }

let indexCache: { books: BookEntry[]; ts: number } | null = null
const INDEX_TTL = 60_000
const ASSET_TTL = 86400

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

async function handleBooksList(env: Env, request: Request) {
  if (!validateRequest(request, env)) return err('UNAUTHORIZED', null, 401)
  const q = new URL(request.url).searchParams.get('q')?.trim().toLowerCase() || ''
  const books = await getIndex(env)
  const result = q ? books.filter(b =>
    b.t.toLowerCase().includes(q) || b.a.toLowerCase().includes(q)) : books
  return json({ books: result })
}

async function handleBooksRoute(env: Env, request: Request, path: string, ctx: ExecutionContext) {
  if (!validateRequest(request, env)) return err('UNAUTHORIZED', null, 401)
  const rest = path.slice('/api/books/'.length)
  const slash = rest.indexOf('/')
  const hash = slash === -1 ? rest : rest.substring(0, slash)
  const sub = slash === -1 ? '' : rest.substring(slash + 1)

  if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400)

  if (!sub) {
    const books = await getIndex(env)
    const book = books.find(b => b.h === hash)
    if (!book) return err('NOT_FOUND', null, 404)
    return json(book)
  }

  if (sub === 'toc') {
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
    const cache = caches.default
    const cached = await cache.match(request)
    if (cached) return cached

    const tag = `v${hash}0`
    const asset = await getReleaseAsset(CONTENT_OWNER, CONTENT_REPO, tag, 'toc.json', GH_PAT)
    if (!asset) return err('NOT_FOUND', null, 404)

    const res = await downloadReleaseAsset(CONTENT_OWNER, CONTENT_REPO, asset.id, GH_PAT)
    if (!res.ok) return err('NOT_FOUND', null, 404)
    const toc = await res.json()

    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ASSET_TTL}` })
    const response = new Response(JSON.stringify(toc), { headers })
    ctx.waitUntil(cache.put(request, response.clone()))
    return response
  }

  if (sub === 'cover') {
    return proxyAsset(env, request, ctx, `v${hash}0`, 'cover.jpg')
  }

  if (sub.startsWith('chapters/')) {
    const chKey = sub.slice('chapters/'.length)
    const chHashLen = 12
    const partStr = chKey.substring(0, chKey.length - chHashLen)
    const partIdx = partStr ? parseInt(partStr, 10) : 0
    const tag = `v${hash}${partIdx}`
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT } = env
    const cache = caches.default
    const cached = await cache.match(request)
    if (cached) return cached

    const asset = await getReleaseAsset(CONTENT_OWNER, CONTENT_REPO, tag, `${chKey}.txt`, GH_PAT)
    if (!asset) return err('NOT_FOUND', null, 404)

    const res = await downloadReleaseAsset(CONTENT_OWNER, CONTENT_REPO, asset.id, GH_PAT)
    if (!res.ok) return err('NOT_FOUND', null, 404)
    const text = await res.text()

    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ASSET_TTL}, immutable` })
    const response = new Response(JSON.stringify({ content: text }), { headers })
    ctx.waitUntil(cache.put(request, response.clone()))
    return response
  }

  return err('NOT_FOUND', null, 404)
}
