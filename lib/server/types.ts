export interface Env {
  LEGADO_SHELF_R2: R2Bucket;
  ASSETS: Fetcher;
  API_KEY: string;
  GH_PAT: string;
  CONTENT_OWNER: string;
  CONTENT_REPO: string;
  R2_ENDPOINT: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  CACHE_TTL: string;
  MAX_UPLOAD_SIZE: string;
}

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'ACTION_RUNNING'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'UPLOAD_TOO_LARGE'
  | 'R2_ERROR'
  | 'GITHUB_ERROR'
  | 'INTERNAL_ERROR';

export interface ErrorBody {
  error: true;
  code: ErrorCode;
  message: string;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function err(code: ErrorCode, message: string, status = 400): Response {
  return json({ error: true, code, message } as ErrorBody, status);
}
