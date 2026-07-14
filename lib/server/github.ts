import { Octokit } from '@octokit/rest'

function client(token: string) {
  return new Octokit({ auth: token, request: { fetch } })
}

/* ── 触发 Action ───────────────────────────── */

export async function isActionRunning(env: {
  CONTENT_OWNER: string; CONTENT_REPO: string; GH_PAT: string
}): Promise<boolean> {
  const octo = client(env.GH_PAT)
  try {
    const { data } = await octo.rest.actions.listWorkflowRuns({
      owner: env.CONTENT_OWNER,
      repo: env.CONTENT_REPO,
      workflow_id: 'main.yml',
      status: 'in_progress',
      per_page: 1,
    })
    return data.total_count > 0
  } catch {
    return false
  }
}

export interface R2Input {
  R2_ENDPOINT: string
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET_NAME: string
}

export async function triggerWorkflow(
  owner: string, repo: string, token: string, r2: R2Input,
): Promise<boolean> {
  const octo = client(token)
  try {
    await octo.rest.actions.createWorkflowDispatch({
      owner, repo,
      workflow_id: 'main.yml',
      ref: 'main',
      inputs: {
        r2_endpoint: r2.R2_ENDPOINT,
        r2_access_key_id: r2.R2_ACCESS_KEY_ID,
        r2_secret_access_key: r2.R2_SECRET_ACCESS_KEY,
        r2_bucket_name: r2.R2_BUCKET_NAME,
      },
    })
    return true
  } catch (e: any) {
    console.error('triggerWorkflow failed:', e.status, e.message)
    return false
  }
}

/* ── 内容仓库 (Release & 索引) ──────────────── */

export interface ReleaseInfo {
  tagName: string
  name: string
  htmlUrl: string
}

export async function checkReleaseExists(
  owner: string, repo: string, tag: string, token: string,
): Promise<ReleaseInfo | null> {
  const octo = client(token)
  try {
    const { data } = await octo.rest.repos.getReleaseByTag({ owner, repo, tag })
    return { tagName: data.tag_name, name: data.name || '', htmlUrl: data.html_url }
  } catch (e: any) {
    if (e.status === 404) return null
    return null
  }
}

export async function getReleaseAsset(
  owner: string, repo: string, tag: string, assetName: string, token: string,
): Promise<{ id: number; contentType: string } | null> {
  const octo = client(token)
  try {
    const { data } = await octo.rest.repos.getReleaseByTag({ owner, repo, tag })
    for (const a of data.assets) {
      if (a.name === assetName) {
        return { id: a.id, contentType: a.content_type }
      }
    }
    console.log(`asset "${assetName}" not found in [${data.assets.map(a => a.name).join(', ')}]`)
  } catch (e: any) {
    console.log(`release "${tag}" error:`, e.status, e.message)
  }
  return null
}

export async function downloadReleaseAsset(
  owner: string, repo: string, assetId: number, token: string,
): Promise<Response> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/octet-stream',
      'User-Agent': 'novel',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
}

export async function getPageContent(
  owner: string, repo: string, path: string, token: string,
): Promise<string | null> {
  const octo = client(token)
  try {
    const { data } = await octo.rest.repos.getContent({ owner, repo, path })
    const b64 = (data as any).content
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch { /* */ }
  return null
}
export async function listReleaseTags(
  owner: string, repo: string, hash: string, token: string,
): Promise<string[]> {
  const octo = client(token)
  const prefix = `v${hash}`
  const tags: string[] = []
  try {
    const releases = await octo.paginate(octo.rest.repos.listReleases, { owner, repo, per_page: 100 })
    for (const r of releases) {
      if (r.tag_name.startsWith(prefix)) tags.push(r.tag_name)
    }
  } catch { /* */ }
  return tags.sort()
}
