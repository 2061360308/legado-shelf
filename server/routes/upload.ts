import { json, err } from '../lib/response'
import { isActionRunning } from '../lib/action'
import { createR2Client, createPresignedUrl } from '../lib/presign'
import { r2Key, fileExists } from '../lib/r2'
import { triggerWorkflow } from '../lib/github'
import { HASH_REGEX, PRESIGN_EXPIRES } from '../../shared/constants'
import type { Router } from '../lib/router'

const PresignBody = {
  type: 'object' as const,
  properties: {
    hash: { type: 'string', description: '书籍 hash（12位hex）', pattern: '^[a-f0-9]{12}
    size: { type: 'integer', description: '文件大小 (bytes)', minimum: 1 },
    title: { type: 'string', description: '书名（可选）', example: '三体' },
  },
  required: ['hash', 'size'],
}

const CompleteBody = {
  type: 'object' as const,
  properties: {
    hash: { type: 'string', description: '书籍 SHA256 hash', pattern: '^[a-f0-9]{12,64}$', example: 'a1b2c3d4e5f6' },
    title: { type: 'string', description: '书名（可选）', example: '三体' },
  },
  required: ['hash'],
}

export function register(router: Router) {
  router.post('/api/upload/presign', async (req, env) => {
    let body: { hash?: string; size?: number; title?: string }
    try { body = await req.json() } catch { return err('INVALID_REQUEST', null, 400) }
    const { hash, size, title } = body
    if (typeof hash !== 'string' || !HASH_REGEX.test(hash))
      return err('INVALID_REQUEST', null, 400)
    const maxSize = parseInt(env.MAX_UPLOAD_SIZE, 10) || 52428800
    if (typeof size !== 'number' || size <= 0 || size > maxSize)
      return err('UPLOAD_TOO_LARGE', null, 400)
    if (await isActionRunning(env)) return err('ACTION_RUNNING', null, 503)

    const key = r2Key(hash, typeof title === 'string' ? title : undefined)
    const client = createR2Client(env)
    const { url } = await createPresignedUrl(client, env.R2_ENDPOINT, {
      bucket: env.R2_BUCKET_NAME, key, size, contentType: 'application/zip',
    })
    return json({ url, key, expiresIn: PRESIGN_EXPIRES })
  }, {
    summary: '获取预签名上传 URL',
    description: '生成 R2 预签名链接，前端可直接 PUT 上传 ZIP。链接有效期内可重复使用。',
    tags: ['Upload'],
    requestBody: {
      description: '上传请求',
      required: true,
      content: { schema: PresignBody },
    },
    responses: {
      '200': {
        description: '预签名 URL',
        content: {
          schema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '预签名上传 URL' },
              key: { type: 'string', description: 'R2 文件 key' },
              expiresIn: { type: 'integer', description: '有效秒数', example: 900 },
            },
          },
        },
      },
      '413': { description: '文件大小超出限制' },
    },
  })

  router.post('/api/upload/complete', async (req, env) => {
    let body: { hash?: string; title?: string }
    try { body = await req.json() } catch { return err('INVALID_REQUEST', null, 400) }
    const { hash, title } = body
    if (typeof hash !== 'string' || !HASH_REGEX.test(hash))
      return err('INVALID_REQUEST', null, 400)
    const key = r2Key(hash, typeof title === 'string' ? title : undefined)
    if (!(await fileExists(key, env))) return err('NOT_FOUND', null, 404)
    if (await isActionRunning(env)) {
      return json({ status: 'queued', hash, message: '文件已接收，将在下一轮被处理' })
    }
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env
    let triggered = false
    if (CONTENT_OWNER && CONTENT_REPO && GH_PAT) {
      triggered = await triggerWorkflow(CONTENT_OWNER, CONTENT_REPO, GH_PAT, { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME })
    }
    return json({ status: triggered ? 'processing' : 'queued', hash, message: triggered ? '处理已开始' : '文件已接收，等待下一轮 Cron 处理' })
  }, {
    summary: '确认上传完成',
    description: '标记上传完成，若 Action 空闲则立即触发处理工作流。',
    tags: ['Upload'],
    requestBody: {
      description: '确认请求',
      required: true,
      content: { schema: CompleteBody },
    },
    responses: {
      '200': {
        description: '处理状态',
        content: {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['processing', 'queued'], description: 'processing=处理中, queued=排队中', example: 'processing' },
              hash: { type: 'string', example: 'a1b2c3d4e5f6' },
              message: { type: 'string', example: '处理已开始' },
            },
          },
        },
      },
    },
  })
}
, example: 'a1b2c3d4e5f6' },
    size: { type: 'integer', description: '文件大小 (bytes)', minimum: 1 },
    title: { type: 'string', description: '书名（可选）', example: '三体' },
  },
  required: ['hash', 'size'],
}

const CompleteBody = {
  type: 'object' as const,
  properties: {
    hash: { type: 'string', description: '书籍 hash（12位hex）', pattern: '^[a-f0-9]{12}
    title: { type: 'string', description: '书名（可选）', example: '三体' },
  },
  required: ['hash'],
}

export function register(router: Router) {
  router.post('/api/upload/presign', async (req, env) => {
    let body: { hash?: string; size?: number; title?: string }
    try { body = await req.json() } catch { return err('INVALID_REQUEST', null, 400) }
    const { hash, size, title } = body
    if (typeof hash !== 'string' || !HASH_REGEX.test(hash))
      return err('INVALID_REQUEST', null, 400)
    const maxSize = parseInt(env.MAX_UPLOAD_SIZE, 10) || 52428800
    if (typeof size !== 'number' || size <= 0 || size > maxSize)
      return err('UPLOAD_TOO_LARGE', null, 400)
    if (await isActionRunning(env)) return err('ACTION_RUNNING', null, 503)

    const key = r2Key(hash, typeof title === 'string' ? title : undefined)
    const client = createR2Client(env)
    const { url } = await createPresignedUrl(client, env.R2_ENDPOINT, {
      bucket: env.R2_BUCKET_NAME, key, size, contentType: 'application/zip',
    })
    return json({ url, key, expiresIn: PRESIGN_EXPIRES })
  }, {
    summary: '获取预签名上传 URL',
    description: '生成 R2 预签名链接，前端可直接 PUT 上传 ZIP。链接有效期内可重复使用。',
    tags: ['Upload'],
    requestBody: {
      description: '上传请求',
      required: true,
      content: { schema: PresignBody },
    },
    responses: {
      '200': {
        description: '预签名 URL',
        content: {
          schema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '预签名上传 URL' },
              key: { type: 'string', description: 'R2 文件 key' },
              expiresIn: { type: 'integer', description: '有效秒数', example: 900 },
            },
          },
        },
      },
      '413': { description: '文件大小超出限制' },
    },
  })

  router.post('/api/upload/complete', async (req, env) => {
    let body: { hash?: string; title?: string }
    try { body = await req.json() } catch { return err('INVALID_REQUEST', null, 400) }
    const { hash, title } = body
    if (typeof hash !== 'string' || !HASH_REGEX.test(hash))
      return err('INVALID_REQUEST', null, 400)
    const key = r2Key(hash, typeof title === 'string' ? title : undefined)
    if (!(await fileExists(key, env))) return err('NOT_FOUND', null, 404)
    if (await isActionRunning(env)) {
      return json({ status: 'queued', hash, message: '文件已接收，将在下一轮被处理' })
    }
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env
    let triggered = false
    if (CONTENT_OWNER && CONTENT_REPO && GH_PAT) {
      triggered = await triggerWorkflow(CONTENT_OWNER, CONTENT_REPO, GH_PAT, { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME })
    }
    return json({ status: triggered ? 'processing' : 'queued', hash, message: triggered ? '处理已开始' : '文件已接收，等待下一轮 Cron 处理' })
  }, {
    summary: '确认上传完成',
    description: '标记上传完成，若 Action 空闲则立即触发处理工作流。',
    tags: ['Upload'],
    requestBody: {
      description: '确认请求',
      required: true,
      content: { schema: CompleteBody },
    },
    responses: {
      '200': {
        description: '处理状态',
        content: {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['processing', 'queued'], description: 'processing=处理中, queued=排队中', example: 'processing' },
              hash: { type: 'string', example: 'a1b2c3d4e5f6' },
              message: { type: 'string', example: '处理已开始' },
            },
          },
        },
      },
    },
  })
}
, example: 'a1b2c3d4e5f6' },
    title: { type: 'string', description: '书名（可选）', example: '三体' },
  },
  required: ['hash'],
}

export function register(router: Router) {
  router.post('/api/upload/presign', async (req, env) => {
    let body: { hash?: string; size?: number; title?: string }
    try { body = await req.json() } catch { return err('INVALID_REQUEST', null, 400) }
    const { hash, size, title } = body
    if (typeof hash !== 'string' || !HASH_REGEX.test(hash))
      return err('INVALID_REQUEST', null, 400)
    const maxSize = parseInt(env.MAX_UPLOAD_SIZE, 10) || 52428800
    if (typeof size !== 'number' || size <= 0 || size > maxSize)
      return err('UPLOAD_TOO_LARGE', null, 400)
    if (await isActionRunning(env)) return err('ACTION_RUNNING', null, 503)

    const key = r2Key(hash, typeof title === 'string' ? title : undefined)
    const client = createR2Client(env)
    const { url } = await createPresignedUrl(client, env.R2_ENDPOINT, {
      bucket: env.R2_BUCKET_NAME, key, size, contentType: 'application/zip',
    })
    return json({ url, key, expiresIn: PRESIGN_EXPIRES })
  }, {
    summary: '获取预签名上传 URL',
    description: '生成 R2 预签名链接，前端可直接 PUT 上传 ZIP。链接有效期内可重复使用。',
    tags: ['Upload'],
    requestBody: {
      description: '上传请求',
      required: true,
      content: { schema: PresignBody },
    },
    responses: {
      '200': {
        description: '预签名 URL',
        content: {
          schema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '预签名上传 URL' },
              key: { type: 'string', description: 'R2 文件 key' },
              expiresIn: { type: 'integer', description: '有效秒数', example: 900 },
            },
          },
        },
      },
      '413': { description: '文件大小超出限制' },
    },
  })

  router.post('/api/upload/complete', async (req, env) => {
    let body: { hash?: string; title?: string }
    try { body = await req.json() } catch { return err('INVALID_REQUEST', null, 400) }
    const { hash, title } = body
    if (typeof hash !== 'string' || !HASH_REGEX.test(hash))
      return err('INVALID_REQUEST', null, 400)
    const key = r2Key(hash, typeof title === 'string' ? title : undefined)
    if (!(await fileExists(key, env))) return err('NOT_FOUND', null, 404)
    if (await isActionRunning(env)) {
      return json({ status: 'queued', hash, message: '文件已接收，将在下一轮被处理' })
    }
    const { CONTENT_OWNER, CONTENT_REPO, GH_PAT, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = env
    let triggered = false
    if (CONTENT_OWNER && CONTENT_REPO && GH_PAT) {
      triggered = await triggerWorkflow(CONTENT_OWNER, CONTENT_REPO, GH_PAT, { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME })
    }
    return json({ status: triggered ? 'processing' : 'queued', hash, message: triggered ? '处理已开始' : '文件已接收，等待下一轮 Cron 处理' })
  }, {
    summary: '确认上传完成',
    description: '标记上传完成，若 Action 空闲则立即触发处理工作流。',
    tags: ['Upload'],
    requestBody: {
      description: '确认请求',
      required: true,
      content: { schema: CompleteBody },
    },
    responses: {
      '200': {
        description: '处理状态',
        content: {
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['processing', 'queued'], description: 'processing=处理中, queued=排队中', example: 'processing' },
              hash: { type: 'string', example: 'a1b2c3d4e5f6' },
              message: { type: 'string', example: '处理已开始' },
            },
          },
        },
      },
    },
  })
}
