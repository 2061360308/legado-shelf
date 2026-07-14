import { AwsClient } from 'aws4fetch';
import { PRESIGN_EXPIRES } from '../shared/constants';

export function createR2Client(env: { R2_ENDPOINT: string; R2_ACCESS_KEY_ID: string; R2_SECRET_ACCESS_KEY: string }) {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
}

export interface PresignOptions {
  bucket: string;
  key: string;
  size: number;
  contentType?: string;
}

export async function createPresignedUrl(
  client: AwsClient,
  endpoint: string,
  opts: PresignOptions,
): Promise<{ url: string; key: string }> {
  const hostname = new URL(endpoint).hostname;
  const fullHost = `${opts.bucket}.${hostname}`;
  const url = `https://${fullHost}/${opts.key}`;

  const headers: Record<string, string> = {
    'Content-Length': String(opts.size),
  };
  if (opts.contentType) {
    headers['Content-Type'] = opts.contentType;
  }

  const signed = await client.sign(url, {
    method: 'PUT',
    headers,
    aws: { signQuery: true },
  });

  return { url: signed.url, key: opts.key };
}
