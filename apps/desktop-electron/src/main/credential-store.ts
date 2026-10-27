import { safeStorage } from 'electron';

/**
 * Opaque credential codec. The persistence layer stores only ciphertext; the
 * plaintext access token never crosses into the database or logs.
 *
 * Electron 45 exposes the (deprecated) synchronous helpers, but on Linux they
 * return false unless a keyring is present. The async variants are the ones
 * that honor `--password-store=basic`, so we use them exclusively.
 */
export interface TokenCodec {
  /** True when a real OS-backed key is available to encrypt tokens. */
  isAvailable(): Promise<boolean>;
  /** Encrypt a plaintext token into an opaque (base64) ciphertext string. */
  encrypt(plaintext: string): Promise<string>;
  /** Decrypt a previously produced ciphertext back into a plaintext token. */
  decrypt(ciphertext: string): Promise<string>;
}

/**
 * Electron `safeStorage` backed by the operating-system keychain (Keychain on
 * macOS, DPAPI on Windows, libsecret on Linux). Tokens are encrypted before
 * they are persisted.
 */
export class SafeStorageTokenCodec implements TokenCodec {
  async isAvailable(): Promise<boolean> {
    try {
      return await safeStorage.isAsyncEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async encrypt(plaintext: string): Promise<string> {
    const buffer = await safeStorage.encryptStringAsync(plaintext);
    return Buffer.from(buffer).toString('base64');
  }

  async decrypt(ciphertext: string): Promise<string> {
    const result = await safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64'));
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object' && 'result' in result) {
      const value = (result as { result: unknown }).result;
      return typeof value === 'string' ? value : String(value);
    }
    return String(result);
  }
}
