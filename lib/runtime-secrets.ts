/**
 * 运行时密钥加解密工具(AES-256-GCM)。
 *
 * 密钥材料来自 API_CONFIG_ENCRYPTION_KEY 或 data/.api-config.key(自动生成)。
 * 供 api_channels 表的 api_key / secret_json 加密落库使用。
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ENCRYPTED_PREFIX = 'enc:v1:';
let encryptionKey: Buffer | null = null;

function localKeyFile(): string {
  return process.env.API_CONFIG_KEY_FILE || path.join(process.cwd(), 'data', '.api-config.key');
}

function readOrCreateLocalKey(): string {
  const file = localKeyFile();
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const material = crypto.randomBytes(32).toString('base64url');
  try {
    fs.writeFileSync(file, material, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return material;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return fs.readFileSync(file, 'utf8').trim();
    }
    throw new Error('无法保存 API 配置加密密钥，请设置 API_CONFIG_ENCRYPTION_KEY');
  }
}

function getEncryptionKey(): Buffer {
  if (encryptionKey) return encryptionKey;
  const material = process.env.API_CONFIG_ENCRYPTION_KEY || readOrCreateLocalKey();
  if (!material) throw new Error('API 配置加密密钥为空');
  encryptionKey = crypto.createHash('sha256').update(material, 'utf8').digest();
  return encryptionKey;
}

export function encryptRuntimeSecret(scope: string, value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(scope, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptRuntimeSecret(scope: string, value: string): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error(`API 配置 ${scope} 不是受支持的密文格式`);
  }
  const [ivText, tagText, encryptedText] = value.slice(ENCRYPTED_PREFIX.length).split(':');
  if (!ivText || !tagText || encryptedText == null) throw new Error(`API 配置 ${scope} 密文损坏`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAAD(Buffer.from(scope, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
}

/** 测试辅助:让改过的 API_CONFIG_ENCRYPTION_KEY 生效。 */
export function resetRuntimeSecretsEncryptionKeyForTests(): void {
  encryptionKey = null;
}
