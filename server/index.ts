import { json, err } from './_utils';
import { validateApiKey } from '../lib/server/auth';
import { isActionRunning } from '../lib/server/action';
import { createR2Client, createPresignedUrl } from '../lib/server/presign';
import { r2Key, fileExists, listFiles, deleteFile } from '../lib/server/r2';
import { checkReleaseExists, listReleaseTags, triggerWorkflow } from '../lib/server/github';
import { HASH_REGEX, UPLOAD_PREFIX, MAX_UPLOAD_SIZE, PRESIGN_EXPIRES } from '../lib/shared/constants';
import type { Env } from '../lib/server/types';

export default {
  async fetch(request, env, ctx) {
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
      if (p.startsWith('/api/novel/')) {
        return handleNovelCheck(env, request, p);
      }
    } catch (e) {
      console.error(e);
      return err('INTERNAL_ERROR', null, 500);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env & { ASSETS: Fetcher }>;

async function handleQueueList(env: Env, request: Request) {
  if (!validateApiKey(request, env)) return err('UNAUTHORIZED', null, 401);
  let running = false;
  try { running = await isActionRunning(env); } catch { /* */ }
  let files: { key: string; size: number; uploaded: string }[] = [];
  try { files = await listFiles(env); } catch (e) { console.error(e); }
  return json({ files, actionRunning: running });
}

async function handleQueueDelete(env: Env, request: Request, path: string) {
  if (!validateApiKey(request, env)) return err('UNAUTHORIZED', null, 401);
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
  if (!validateApiKey(request, env)) return err('UNAUTHORIZED', null, 401);
  let body: { hash?: string; size?: number; title?: string };
  try { body = await request.json(); } catch { return err('INVALID_REQUEST', null, 400); }
  const { hash, size, title } = body;
  if (typeof hash !== 'string' || !HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400);
  if (typeof size !== 'number' || size <= 0 || size > MAX_UPLOAD_SIZE) return err('UPLOAD_TOO_LARGE', null, 400);
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
  if (!validateApiKey(request, env)) return err('UNAUTHORIZED', null, 401);
  let body: { hash?: string; title?: string };
  try { body = await request.json(); } catch { return err('INVALID_REQUEST', null, 400); }
  const { hash, title } = body;
  if (typeof hash !== 'string' || !HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400);
  const key = r2Key(hash, typeof title === 'string' ? title : undefined);
  if (!(await fileExists(key, env))) return err('NOT_FOUND', null, 404);
  if (await isActionRunning(env)) {
    return json({ status: 'queued', hash, message: '文件已接收，将在下一轮被处理' });
  }
  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN } = env;
  let triggered = false;
  if (GITHUB_OWNER && GITHUB_REPO && GITHUB_TOKEN) {
    triggered = await triggerWorkflow(GITHUB_OWNER, GITHUB_REPO, hash, GITHUB_TOKEN);
  }
  return json({ status: triggered ? 'processing' : 'queued', hash, message: triggered ? '处理已开始' : '文件已接收，等待下一轮 Cron 处理' });
}

async function handleTrigger(env: Env, request: Request) {
  if (!validateApiKey(request, env)) return err('UNAUTHORIZED', null, 401);
  if (await isActionRunning(env)) return err('ACTION_RUNNING', null, 503);

  const { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN } = env;
  if (!GITHUB_OWNER || !GITHUB_REPO || !GITHUB_TOKEN) {
    return err('GITHUB_ERROR', null, 500);
  }

  const ok = await triggerWorkflow(GITHUB_OWNER, GITHUB_REPO, '', GITHUB_TOKEN);
  return json({ triggered: ok });
}

async function handleNovelCheck(env: Env, request: Request, path: string) {
  if (!validateApiKey(request, env)) return err('UNAUTHORIZED', null, 401);
  const hash = path.slice('/api/novel/'.length);
  if (!HASH_REGEX.test(hash)) return err('INVALID_REQUEST', null, 400);
  const { CONTENT_OWNER, CONTENT_REPO, GITHUB_TOKEN } = env;
  if (!CONTENT_OWNER || !CONTENT_REPO || !GITHUB_TOKEN) return err('GITHUB_ERROR', null, 500);
  const tag = `v${hash}0`;
  const release = await checkReleaseExists(CONTENT_OWNER, CONTENT_REPO, tag, GITHUB_TOKEN);
  if (!release) return json({ exists: false });
  const tags = await listReleaseTags(CONTENT_OWNER, CONTENT_REPO, hash, GITHUB_TOKEN);
  return json({ exists: true, guri: `urn:novel:sha256:${hash}`, tags, releaseUrl: release.htmlUrl });
}
