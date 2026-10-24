// The encryption behind the device vault. No Angular here, so it can be tested on its own.
//
//   password --scrypt--> key-encryption key (KEK) --unlocks--> data key (DEK, random, 32 bytes)
//   DEK --HMAC--> "data key" (encrypts values) and "name key" (hides the storage names)
//
// Values are sealed with XChaCha20-Poly1305: wrong password, tampering and moving a value to another
// name are all detected. The libraries are @noble/ciphers and @noble/hashes (audited, plain JavaScript),
// which also work on a page served over plain HTTP, where the browser's own crypto is not offered.

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToUtf8, equalBytes, randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

export interface KdfParams {
  N: number;
  r: number;
  p: number;
}

/** Stored next to the data so that the cost can be raised later without locking anyone out. */
export interface VaultHeader extends KdfParams {
  v: 1;
  kdf: 'scrypt';
  salt: string;
  wrapped: string;
}

/** About 0.2 s on a computer, around a second on a phone. */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 15, r: 8, p: 1 };

const NAME_PREFIX = 'itbv:';
const VERSION = '1.';

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Turns a password into a key. The same password in a different Unicode form gives the same key. */
export function deriveKey(password: string, salt: Uint8Array, params: KdfParams = DEFAULT_KDF): Promise<Uint8Array> {
  return scryptAsync(utf8ToBytes(password.normalize('NFKC')), salt, { N: params.N, r: params.r, p: params.p, dkLen: 32 });
}

/** Encrypts and authenticates `data`. `aad` is not hidden but is checked when opening. */
export function seal(key: Uint8Array, aad: string, data: Uint8Array): string {
  const nonce = randomBytes(24);
  const encrypted = xchacha20poly1305(key, nonce, utf8ToBytes(aad)).encrypt(data);
  const out = new Uint8Array(nonce.length + encrypted.length);
  out.set(nonce, 0);
  out.set(encrypted, nonce.length);
  return VERSION + toBase64(out);
}

/** The data, or null if the key is wrong, the data was changed, or it belongs to another name. */
export function open(key: Uint8Array, aad: string, sealed: string): Uint8Array | null {
  try {
    if (typeof sealed !== 'string' || !sealed.startsWith(VERSION)) return null;
    const bytes = fromBase64(sealed.slice(VERSION.length));
    if (bytes.length < 24 + 16) return null;
    return xchacha20poly1305(key, bytes.subarray(0, 24), utf8ToBytes(aad)).decrypt(bytes.subarray(24));
  } catch {
    return null;
  }
}

const headerAad = (p: KdfParams) => `itb/vault-header/1/${p.N}/${p.r}/${p.p}`;

/** Locks a data key with a password. */
export async function createHeader(password: string, dek: Uint8Array, params: KdfParams = DEFAULT_KDF): Promise<VaultHeader> {
  const salt = randomBytes(16);
  const kek = await deriveKey(password, salt, params);
  return { v: 1, kdf: 'scrypt', N: params.N, r: params.r, p: params.p, salt: toBase64(salt), wrapped: seal(kek, headerAad(params), dek) };
}

/** The data key, or null if the password is wrong. */
export async function openHeader(header: VaultHeader, password: string): Promise<Uint8Array | null> {
  try {
    if (header.v !== 1 || header.kdf !== 'scrypt') return null;
    const kek = await deriveKey(password, fromBase64(header.salt), header);
    return open(kek, headerAad(header), header.wrapped);
  } catch {
    return null;
  }
}

export const newDataKey = (): Uint8Array => randomBytes(32);

const subKey = (dek: Uint8Array, purpose: string): Uint8Array => hmac(sha256, dek, utf8ToBytes(purpose));
export const dataKeyOf = (dek: Uint8Array): Uint8Array => subKey(dek, 'itb/data-key');
export const nameKeyOf = (dek: Uint8Array): Uint8Array => subKey(dek, 'itb/name-key');

/** The name a value is stored under. It shows nothing about what the value is (no meeting names). */
export function storageName(dek: Uint8Array, logicalName: string): string {
  return NAME_PREFIX + hex(hmac(sha256, nameKeyOf(dek), utf8ToBytes(logicalName))).slice(0, 32);
}

export const isVaultName = (storedName: string): boolean => storedName.startsWith(NAME_PREFIX);

const valueAad = (logicalName: string) => `itb/value/${logicalName}`;

export function sealValue(dek: Uint8Array, logicalName: string, value: unknown): string {
  return seal(dataKeyOf(dek), valueAad(logicalName), utf8ToBytes(JSON.stringify(value)));
}

export function openValue<T>(dek: Uint8Array, logicalName: string, sealed: string): T | null {
  const bytes = open(dataKeyOf(dek), valueAad(logicalName), sealed);
  if (!bytes) return null;
  try {
    return JSON.parse(bytesToUtf8(bytes)) as T;
  } catch {
    return null;
  }
}

/** Compares two byte strings in constant time (for the duress code). */
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => equalBytes(a, b);
