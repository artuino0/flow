import fs from 'node:fs/promises'
import path from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export type StorageDriver = 'local' | 'r2'

export class StorageConfigurationError extends Error {}
export class StoredObjectNotFoundError extends Error {}

export interface PutStoredObjectInput {
  key: string
  body: Buffer
  contentType?: string
  cacheControl?: string
}

export interface StoredObjectAdapter {
  put(input: PutStoredObjectInput): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

let adapter: StoredObjectAdapter | null = null
export function setStoredObjectAdapter(value: StoredObjectAdapter | null) { adapter = value }

function localRoot() {
  return process.env.FILES_STORAGE_DIR
    ? path.resolve(process.env.FILES_STORAGE_DIR)
    : path.resolve(process.cwd(), 'uploads')
}

function driver(): StorageDriver {
  const configured = process.env.STORAGE_DRIVER?.trim().toLowerCase()
  if (!configured || configured === 'local') return 'local'
  if (configured === 'r2') return 'r2'
  throw new StorageConfigurationError(`STORAGE_DRIVER inválido: "${configured}". Usa "local" o "r2".`)
}

function assertKey(key: string) {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    throw new StorageConfigurationError('La ruta del archivo no es válida')
  }
}

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new StorageConfigurationError('R2 no está configurado. Completa R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET_NAME.')
  }
  return { accountId, accessKeyId, secretAccessKey, bucket }
}

let r2Client: S3Client | null = null
function getR2Client() {
  const config = r2Config()
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    })
  }
  return { client: r2Client, bucket: config.bucket }
}

export function localObjectPath(key: string) {
  assertKey(key)
  return path.join(localRoot(), ...key.split('/'))
}

export async function putStoredObject(input: PutStoredObjectInput): Promise<void> {
  assertKey(input.key)
  if (adapter) return adapter.put(input)
  if (driver() === 'local') {
    const target = localObjectPath(input.key)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, input.body)
    return
  }
  const { client, bucket } = getR2Client()
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: input.cacheControl
  }))
}

export async function getStoredObject(key: string): Promise<Buffer> {
  assertKey(key)
  if (adapter) return adapter.get(key)
  if (driver() === 'local') {
    try { return await fs.readFile(localObjectPath(key)) } catch (error: any) {
      if (error?.code === 'ENOENT') throw new StoredObjectNotFoundError('Archivo no encontrado')
      throw error
    }
  }
  const { client, bucket } = getR2Client()
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!result.Body) throw new StoredObjectNotFoundError('Archivo no encontrado')
    return Buffer.from(await result.Body.transformToByteArray())
  } catch (error: any) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) throw new StoredObjectNotFoundError('Archivo no encontrado')
    throw error
  }
}

export async function deleteStoredObject(key: string): Promise<void> {
  assertKey(key)
  if (adapter) return adapter.delete(key)
  if (driver() === 'local') {
    await fs.rm(localObjectPath(key), { force: true })
    return
  }
  const { client, bucket } = getR2Client()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

export function usingR2() {
  return driver() === 'r2'
}
