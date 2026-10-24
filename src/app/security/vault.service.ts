import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  createHeader, DEFAULT_KDF, isVaultName, KdfParams, newDataKey, openHeader, openValue, sealValue,
  storageName, VaultHeader,
} from './vault-crypto';

/** The cost of turning the password into a key. Tests use a cheaper one. */
export const VAULT_KDF = new InjectionToken<KdfParams>('VAULT_KDF', { providedIn: 'root', factory: () => DEFAULT_KDF });

/** The only things kept in plain text: this header (the data key, locked with the password) and the app context. */
export const VAULT_HEADER_KEY = 'itb-vault';

/** What older versions kept in plain text. It is removed as soon as the vault is open. */
const LEGACY_KEYS = ['token', 'currentUser', 'lastActivity', 'selectedWhatsAppGroup'];
const LEGACY_PREFIXES = ['itb-cache-v1:', 'itb-offline-http-v1:'];

/**
 * Everything this app keeps on the device is encrypted with one random data key. The data key is stored
 * only in locked form (with the password) and, while the app is in use, in memory. Locking the app
 * (logout, idle, closing the page) forgets it: the stored data cannot be read again without the password.
 */
@Injectable({ providedIn: 'root' })
export class VaultService {
  private kdf = inject(VAULT_KDF);
  private dek: Uint8Array | null = null;

  readonly unlocked = signal(false);

  private readHeader(): VaultHeader | null {
    try {
      const raw = localStorage.getItem(VAULT_HEADER_KEY);
      if (!raw) return null;
      const header = JSON.parse(raw) as VaultHeader;
      return header && header.v === 1 && typeof header.salt === 'string' && typeof header.wrapped === 'string' ? header : null;
    } catch {
      return null;
    }
  }

  hasVault(): boolean {
    return this.readHeader() !== null;
  }

  isUnlocked(): boolean {
    return this.dek !== null;
  }

  /** Starts a new vault on this device (the old one, if any, is gone). */
  async create(password: string): Promise<void> {
    const dek = newDataKey();
    const header = await createHeader(password, dek, this.kdf);
    this.clearData();
    localStorage.setItem(VAULT_HEADER_KEY, JSON.stringify(header));
    this.useKey(dek);
  }

  /** Opens the vault. Returns false for a wrong password. */
  async unlock(password: string): Promise<boolean> {
    const header = this.readHeader();
    if (!header) return false;
    const dek = await openHeader(header, password);
    if (!dek) return false;
    this.useKey(dek);
    return true;
  }

  /** Checks a password against the vault without opening it. */
  async checkPassword(password: string): Promise<boolean> {
    const header = this.readHeader();
    if (!header) return false;
    const dek = await openHeader(header, password);
    dek?.fill(0);
    return dek !== null;
  }

  /** Locks the vault again with a new password. The data stays as it is. */
  async changePassword(newPassword: string): Promise<void> {
    if (!this.dek) throw new Error('The vault is locked');
    const header = await createHeader(newPassword, this.dek, this.kdf);
    localStorage.setItem(VAULT_HEADER_KEY, JSON.stringify(header));
  }

  /** Forgets the data key. Nothing stored can be read until the vault is opened with the password. */
  lock(): void {
    this.dek?.fill(0);
    this.dek = null;
    this.unlocked.set(false);
  }

  /** Removes the locked key as well, so that the stored data can never be read again. */
  destroy(): void {
    try {
      localStorage.removeItem(VAULT_HEADER_KEY);
    } catch {
      // nothing more can be done here
    }
    this.lock();
    this.clearData();
  }

  private useKey(dek: Uint8Array): void {
    this.dek?.fill(0);
    this.dek = dek;
    this.unlocked.set(true);
    this.removeLegacyPlainText();
  }

  // ---------------------------------------------------------------- storage

  getItem<T>(name: string): T | null {
    if (!this.dek) return null;
    try {
      const raw = localStorage.getItem(storageName(this.dek, name));
      return raw === null ? null : openValue<T>(this.dek, name, raw);
    } catch {
      return null;
    }
  }

  /** Returns false if the vault is locked or the browser refused to store it (storage full). */
  setItem(name: string, value: unknown): boolean {
    if (!this.dek) return false;
    try {
      localStorage.setItem(storageName(this.dek, name), sealValue(this.dek, name, value));
      return true;
    } catch {
      return false;
    }
  }

  removeItem(name: string): void {
    if (!this.dek) return;
    try {
      localStorage.removeItem(storageName(this.dek, name));
    } catch {
      // ignore
    }
  }

  /** Removes everything stored in the vault (not the header). */
  clearData(): void {
    try {
      for (const key of Object.keys(localStorage)) {
        if (isVaultName(key)) localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }

  // ---------------------------------------------------------------- values kept elsewhere (the offline queue)

  seal(name: string, value: unknown): string {
    if (!this.dek) throw new Error('The vault is locked');
    return sealValue(this.dek, name, value);
  }

  open<T>(name: string, sealed: string): T | null {
    return this.dek ? openValue<T>(this.dek, name, sealed) : null;
  }

  private removeLegacyPlainText(): void {
    try {
      for (const key of Object.keys(localStorage)) {
        if (LEGACY_KEYS.includes(key) || LEGACY_PREFIXES.some(prefix => key.startsWith(prefix))) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // ignore
    }
  }
}
