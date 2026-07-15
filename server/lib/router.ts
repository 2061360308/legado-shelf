import { err } from './response'
import { validateRequest } from './auth'
import type { Env } from './types'

/* ── 类型定义 ─────────────────────────────── */

export interface ParamDef {
  type?: string
  format?: string
  description?: string
  example?: string | number
  required?: boolean
  pattern?: string
  minLength?: number
  maxLength?: number
}

export interface QueryDef extends ParamDef {}

export interface SchemaProperty {
  type: string
  format?: string
  description?: string
  example?: any
  enum?: any[]
  items?: { type: string }
}

export interface ObjectSchema {
  type: 'object'
  properties: Record<string, SchemaProperty>
  required?: string[]
  example?: any
}

export interface ArraySchema {
  type: 'array'
  items: ObjectSchema | { type: string }
}

export type Schema = ObjectSchema | ArraySchema | { type: string; example?: any }

export interface RequestBodyDef {
  description?: string
  required?: boolean
  content: { schema: Schema }
}

export interface ResponseDef {
  description: string
  content?: { schema: Schema }
}

export interface RouteMeta {
  summary?: string
  description?: string
  tags?: string[]
  auth?: boolean
  operationId?: string
  params?: Record<string, ParamDef>
  query?: Record<string, QueryDef>
  requestBody?: RequestBodyDef
  responses?: Record<string, ResponseDef>
}

export type Handler = (
  req: Request, env: Env, ctx: ExecutionContext,
  params: Record<string, string>,
) => Response | Promise<Response>

interface Route {
  methods: string[]
  pattern: URLPattern
  handler: Handler
  meta: RouteMeta
}

/* ── 共享 Schema ──────────────────────────── */

const ERROR_SCHEMA: ObjectSchema = {
  type: 'object',
  properties: {
    error: { type: 'boolean', description: '始终为 true', example: true },
    code: { type: 'string', description: '错误码，如 NOT_FOUND / UNAUTHORIZED / DUPLICATE_HASH 等', example: 'NOT_FOUND' },
    message: { type: 'string', description: '错误描述', example: '资源不存在' },
  },
  required: ['error', 'code', 'message'],
}

function errResponse(code: string, description: string): ResponseDef {
  return { description: `[${code}] ${description}`, content: { schema: ERROR_SCHEMA } }
}

const DEFAULT_ERRORS: Record<string, { code: string; desc: string }> = {
  '400': { code: 'INVALID_REQUEST', desc: '请求参数无效' },
  '401': { code: 'UNAUTHORIZED', desc: '未授权，请提供有效的 API Key' },
  '500': { code: 'INTERNAL_ERROR', desc: '服务器内部错误' },
}

/* ── operationId 生成 ─────────────────────── */

function toOperationId(method: string, pathname: string): string {
  const parts = pathname
    .replace(/^\/api\//, '')
    .split('/')
    .map(p => p.startsWith(':') ? p.slice(1) : p)
    .filter(Boolean)
    .map((p, i) =>
      i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)
    )
    .join('')
  const verb = method.toLowerCase()
  return parts.startsWith(verb) ? parts : verb + parts.charAt(0).toUpperCase() + parts.slice(1)
}

/* ── Router ───────────────────────────────── */

export class Router {
  private routes: Route[] = []
  private info: { title: string; version: string }

  constructor(info: { title: string; version: string }) {
    this.info = info
  }

  private add(methods: string[], path: string, handler: Handler, meta: RouteMeta = {}) {
    meta.operationId ??= toOperationId(methods[0], path)
    meta.auth ??= true
    this.routes.push({
      methods,
      pattern: new URLPattern({ pathname: path }),
      handler,
      meta,
    })
  }

  get(path: string, handler: Handler, meta?: RouteMeta) { this.add(['GET'], path, handler, meta) }
  post(path: string, handler: Handler, meta?: RouteMeta) { this.add(['POST'], path, handler, meta) }
  delete(path: string, handler: Handler, meta?: RouteMeta) { this.add(['DELETE'], path, handler, meta) }

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
    const url = new URL(req.url)
    for (const route of this.routes) {
      if (!route.methods.includes(req.method)) continue
      const match = route.pattern.exec(url)
      if (!match) continue

      try {
        const params = Object.fromEntries(
          Object.entries(match.pathname.groups).map(([k, v]) => [k, v ?? ''])
        )
        if (route.meta.auth !== false) {
          if (!validateRequest(req, env)) return err('UNAUTHORIZED', null, 401)
        }
        return await route.handler(req, env, ctx, params)
      } catch (e) {
        console.error(e)
        return err('INTERNAL_ERROR', null, 500)
      }
    }
    return null
  }

  toOpenAPIDoc() {
    const paths: Record<string, any> = {}
    const tags = new Set<string>()

    for (const { methods, pattern, meta } of this.routes) {
      const pathKey = pattern.pathname.replace(/:(\w+)/g, '{$1}')
      if (!paths[pathKey]) paths[pathKey] = {}

      const responses: Record<string, any> = {}

      // 自定义响应
      for (const [code, def] of Object.entries(meta.responses || {})) {
        responses[code] = {
          description: def.description,
          ...(def.content ? { content: { 'application/json': { schema: def.content.schema } } } : {}),
        }
      }

      // 补充未覆盖的默认错误响应
      for (const [code, e] of Object.entries(DEFAULT_ERRORS)) {
        if (!responses[code]) {
          responses[code] = { description: `[${e.code}] ${e.desc}`, content: { 'application/json': { schema: ERROR_SCHEMA } } }
        }
      }

      const operation: any = {
        operationId: meta.operationId,
        summary: meta.summary || '',
        description: meta.description || '',
        tags: meta.tags || ['default'],
        responses,
      }

      if (meta.auth !== false) {
        operation.security = [{ ApiKeyAuth: [] }]
      } else {
        operation.security = []
      }

      if (meta.params) {
        for (const [name, s] of Object.entries(meta.params)) {
          operation.parameters = operation.parameters || []
          operation.parameters.push({
            name, in: 'path', required: s.required ?? true,
            schema: {
              type: s.type || 'string',
              ...(s.format ? { format: s.format } : {}),
              ...(s.pattern ? { pattern: s.pattern } : {}),
              ...(s.example !== undefined ? { example: s.example } : {}),
              ...(s.minLength ? { minLength: s.minLength } : {}),
              ...(s.maxLength ? { maxLength: s.maxLength } : {}),
            },
            description: s.description || '',
          })
        }
      }

      if (meta.query) {
        for (const [name, s] of Object.entries(meta.query)) {
          operation.parameters = operation.parameters || []
          operation.parameters.push({
            name, in: 'query', required: s.required ?? false,
            schema: {
              type: s.type || 'string',
              ...(s.format ? { format: s.format } : {}),
              ...(s.example !== undefined ? { example: s.example } : {}),
            },
            description: s.description || '',
          })
        }
      }

      if (meta.requestBody) {
        operation.requestBody = {
          required: meta.requestBody.required ?? true,
          description: meta.requestBody.description || '',
          content: { 'application/json': { schema: meta.requestBody.content.schema } },
        }
      }

      for (const tag of (meta.tags || ['default'])) tags.add(tag)
      for (const method of methods) {
        paths[pathKey][method.toLowerCase()] = operation
      }
    }

    return {
      openapi: '3.0.3',
      info: { title: this.info.title, version: this.info.version },
      servers: [
        { url: 'https://{worker}.workers.dev', description: 'Cloudflare Workers', variables: { worker: { default: 'legado-shelf' } } },
      ],
      security: [{ ApiKeyAuth: [] }],
      components: {
        securitySchemes: {
          ApiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'authorization',
            description: 'Bearer {API_KEY}',
          },
        },
        schemas: {
          Error: {
            type: 'object',
            properties: {
              error: { type: 'boolean', example: true },
              code: { type: 'string', example: 'NOT_FOUND' },
              message: { type: 'string', example: '资源不存在' },
            },
            required: ['error', 'code', 'message'],
          },
        },
      },
      paths,
      tags: [...tags].map(name => ({ name })),
    }
  }
}
