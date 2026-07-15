import { json } from '../lib/response'
import type { Router } from '../lib/router'

import bookSourceTemplate from '../../support/legado/bookSource.json' with { type: 'json' }

export function register(router: Router) {
  router.get('/api/bookSource.json', (req) => {
    const url = new URL(req.url)
    const bookSourceUrl = url.searchParams.get('bookSourceUrl') || ''
    const apiKey = url.searchParams.get('API_KEY') || ''

    const content = JSON.stringify(bookSourceTemplate)
      .replaceAll('{{**SITE_URL**}}', bookSourceUrl)
      .replaceAll('{{**API_KEY**}}', apiKey)

    return new Response(content, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }, {
    auth: false,
    summary: '获取 Legado 书源配置',
    description: '返回书源 JSON，传入 `bookSourceUrl` 和 `API_KEY` 替换模板中的域名和密钥。无需鉴权。',
    tags: ['Legado'],
    query: {
      bookSourceUrl: { type: 'string', description: 'Worker 部署域名', required: true, example: 'https://legado-shelf.yourname.workers.dev' },
      API_KEY: { type: 'string', description: '你的 API Key', required: true, example: '123456' },
    },
    responses: { '200': { description: 'Legado 书源 JSON' } },
  })
}
