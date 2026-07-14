import { Router } from './lib/router'
import { json } from './lib/response'
import type { Env } from './lib/types'

import { register as registerQueue } from './routes/queue'
import { register as registerUpload } from './routes/upload'
import { register as registerTrigger } from './routes/trigger'
import { register as registerBooks } from './routes/books'

const router = new Router({ title: 'legado-shelf', version: '1.0.0' })
registerQueue(router)
registerUpload(router)
registerTrigger(router)
registerBooks(router)

router.get('/api/openapi.json', () => {
  return json(router.toOpenAPIDoc())
}, { auth: false, summary: 'OpenAPI 文档', tags: ['Meta'] })

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const res = await router.fetch(request, env, ctx)
    if (res) return res
    return env.ASSETS?.fetch(request) ?? new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
