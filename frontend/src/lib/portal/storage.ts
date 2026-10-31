import 'server-only'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { prisma } from './db'
import { randomToken } from './crypto'

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const SIGNED_URL_TTL_SECONDS = 15 * 60

const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
} as const

export type AllowedMime = keyof typeof ALLOWED

// Type is sniffed from magic bytes, never trusted from the client (§11.3).
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf'
  return null
}

function s3Config() {
  const bucket = process.env.S3_BUCKET
  if (!bucket) return null
  return {
    bucket,
    client: new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
    }),
  }
}

// Without S3 configured (local dev) files go to a private, gitignored folder.
const LOCAL_DIR = path.join(process.cwd(), '.uploads')

export class UploadError extends Error {}

export async function storeUpload(file: File, opts: { uploadedById: string; purpose: string; allow?: AllowedMime[] }) {
  if (file.size === 0) throw new UploadError('The file is empty.')
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('Files must be 5 MB or smaller.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffMime(bytes)
  const allow = opts.allow ?? (Object.keys(ALLOWED) as AllowedMime[])
  if (!mime || !allow.includes(mime)) {
    throw new UploadError(`Only ${allow.map((type) => ALLOWED[type].toUpperCase()).join(', ')} files are accepted.`)
  }

  const key = `${opts.purpose}/${randomToken(18)}.${ALLOWED[mime]}`
  const s3 = s3Config()
  if (s3) {
    await s3.client.send(new PutObjectCommand({ Bucket: s3.bucket, Key: key, Body: bytes, ContentType: mime }))
  } else {
    const target = path.join(LOCAL_DIR, key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }

  await prisma.fileUpload.create({
    data: { key, mime, sizeBytes: file.size, uploadedById: opts.uploadedById, purpose: opts.purpose },
  })
  return key
}

/**
 * Callers must run authorize() on the parent record first. Returns a 15-minute signed URL
 * for S3, or the bytes for local storage.
 */
export async function readUpload(key: string): Promise<{ redirect: string } | { bytes: Buffer; mime: string }> {
  const upload = await prisma.fileUpload.findUnique({ where: { key } })
  if (!upload) throw new UploadError('File not found.')
  const s3 = s3Config()
  if (s3) {
    const url = await getSignedUrl(s3.client, new GetObjectCommand({ Bucket: s3.bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    })
    return { redirect: url }
  }
  const resolved = path.resolve(LOCAL_DIR, key)
  if (!resolved.startsWith(path.resolve(LOCAL_DIR))) throw new UploadError('Invalid key.')
  return { bytes: await readFile(resolved), mime: upload.mime }
}
