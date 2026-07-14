import { json, err } from '../lib/response'
import { isActionRunning } from '../lib/action'
import { fileExists, listFiles, deleteFile } from '../lib/r2'
import { UPLOAD_PREFIX } from '../../shared/constants'
import type { Router } from '../lib/router'

const QueueFileSchema = {
  type: 'object' as const,
  properties: {
    key: { type: 'string', description: '文件 key', example: 'uploads/a1b2c3d4e5f6_三体.zip' },
    size: { type: 'integer', description: '文件大小 (bytes)' },
    uploaded: { type: 'string', format: 'date-time', description: '上传时间' },
  },
}

export function register(router: Router) {
  router.get('/api/queue', async (_req, env) => {
    let running = false
    try { running = await isActionRunning(env) } catch { /* */ }
    let files: { key: string; size: number; uploaded: string }[] = []
    try { files = await listFiles(env) } catch (e) { console.error(e) }
    return json({ files, actionRunning: running })
  }, {
    summary: '列出待处理文件',
    tags: ['Queue'],
    responses: {
      '200': {
        description: '文件列表及 Action 运行状态',
        content: { schema: { type: 'object', properties: { files: { type: 'array', items: QueueFileSchema }, actionRunning: { type: 'boolean' } } } },
      },
    },
  })

  router.delete('/api/queue/:key', async (_req, env, _ctx, params) => {
    if (await isActionRunning(env)) return err('ACTION_RUNNING', null, 503)
    const key = decodeURIComponent(params.key)
    if (!key.startsWith(UPLOAD_PREFIX)) return err('INVALID_REQUEST', null, 400)
    try {
      if (!(await fileExists(key, env))) return err('NOT_FOUND', null, 404)
      await deleteFile(key, env)
    } catch { return err('R2_ERROR', null, 500) }
    return json({ deleted: true, key })
  }, {
    summary: '删除待处理文件',
    tags: ['Queue'],
    params: { key: { description: '文件路径', example: 'uploads/abc123_title.zip' } },
    responses: {
      '200': { description: '删除成功', content: { schema: { type: 'object', properties: { deleted: { type: 'boolean' }, key: { type: 'string' } } } } },
      '503': { description: 'Action 运行中，禁止操作' },
    },
  })
}
