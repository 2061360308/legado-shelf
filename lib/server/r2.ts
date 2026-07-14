import { UPLOAD_PREFIX } from '../shared/constants';
import type { Env } from './types';
import type { QueuedFile } from '../shared/types';

export function r2Key(hash: string, title?: string): string {
  if (title) return `${UPLOAD_PREFIX}${hash}_${title}.zip`
  return `${UPLOAD_PREFIX}${hash}.zip`
}

export function hashFromKey(key: string): string {
  const base = key.replace(UPLOAD_PREFIX, '').replace(/\.zip$/, '')
  const idx = base.indexOf('_')
  if (idx === -1) return base
  return base.substring(0, idx)
}

export async function fileExists(key: string, env: Env): Promise<boolean> {
  const obj = await env.LEGADO_SHELF_R2.head(key);
  return obj !== null;
}

export async function listFiles(env: Env): Promise<QueuedFile[]> {
  const listed = await env.LEGADO_SHELF_R2.list({ prefix: UPLOAD_PREFIX });
  return listed.objects.map(obj => ({
    key: obj.key,
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
  }));
}

export async function deleteFile(key: string, env: Env): Promise<void> {
  await env.LEGADO_SHELF_R2.delete(key);
}
