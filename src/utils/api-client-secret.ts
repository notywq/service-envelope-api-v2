import crypto from 'crypto';

const API_CLIENT_ID_BYTES = 18;
const API_CLIENT_SECRET_BYTES = 32;
const API_CLIENT_SECRET_KEY_LENGTH = 32;

export function generateApiClientCredentials(): { clientId: string; clientSecret: string } {
  return {
    clientId: `cli_${crypto.randomBytes(API_CLIENT_ID_BYTES).toString('base64url')}`,
    clientSecret: `sec_${crypto.randomBytes(API_CLIENT_SECRET_BYTES).toString('base64url')}`,
  };
}

export function generateApiClientSecretSalt(): string {
  return crypto.randomBytes(16).toString('base64url');
}

export function hashApiClientSecret(secret: string, salt: string): string {
  return crypto.scryptSync(secret, salt, API_CLIENT_SECRET_KEY_LENGTH).toString('hex');
}

export function verifyApiClientSecret(secret: string, salt: string, expectedHash: string): boolean {
  try {
    const actual = Buffer.from(hashApiClientSecret(secret, salt), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
