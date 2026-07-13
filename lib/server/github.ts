import { Octokit } from '@octokit/rest'

function client(token: string) {
  return new Octokit({ auth: token, request: { fetch } })
}

/* ── 代码仓库 (触发 Action) ────────────────── */

export async function isActionRunning(env: {
  GITHUB_OWNER: string; GITHUB_REPO: string; GITHUB_TOKEN: string
}): Promise<boolean> {
  const octo = client(env.GITHUB_TOKEN)
  try {
    const { data } = await octo.rest.actions.listWorkflowRuns({
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      workflow_id: 'main.yml',
      status: 'in_progress',
      per_page: 1,
    })
    return data.total_count > 0
  } catch {
    return false
  }
}

export async function triggerWorkflow(
  owner: string, repo: string, hash: string, token: string,
): Promise<boolean> {
  const octo = client(token)
  try {
    const inputs: Record<string, string> = {}
    if (hash) inputs.hash = hash
    await octo.rest.actions.createWorkflowDispatch({
      owner, repo,
      workflow_id: 'main.yml',
      ref: 'main',
      inputs,
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
