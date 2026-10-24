import { Injectable, inject } from '@angular/core';
import { deriveKey, fromBase64, newDataKey, sameBytes, toBase64 } from './vault-crypto';
import { VAULT_KDF } from './vault.service';

/** Where the duress code's check is kept. The name says nothing about what it is. */
export const DURESS_KEY = 'itb-ui';

interface DuressRecord {
  v: 1;
  N: number;
  r: number;
  p: number;
  salt: string;
  hash: string;
}

/**
 * The duress code: typed instead of the password, it wipes this device and shows a game (see
 * DeviceWipeService). Only a one-way check of the code is kept, so the code itself cannot be read from
 * the device, and the check survives a wipe so that the code keeps working.
 */
@Injectable({ providedIn: 'root' })
export class DuressService {
  private kdf = inject(VAULT_KDF);

  private read(): DuressRecord | null {
    try {
      const raw = localStorage.getItem(DURESS_KEY);
      if (!raw) return null;
      const record = JSON.parse(raw) as DuressRecord;
      return record && record.v === 1 && typeof record.salt === 'string' && typeof record.hash === 'string' ? record : null;
    } catch {
      return null;
    }
  }

  isSet(): boolean {
    return this.read() !== null;
  }

  async set(code: string): Promise<void> {
    if (!code) throw new Error('The duress code cannot be empty');
    const salt = newDataKey().subarray(0, 16);
    const hash = await deriveKey(code, salt, this.kdf);
    const record: DuressRecord = { v: 1, N: this.kdf.N, r: this.kdf.r, p: this.kdf.p, salt: toBase64(salt), hash: toBase64(hash) };
    localStorage.setItem(DURESS_KEY, JSON.stringify(record));
  }

  /** True if `input` is the duress code. */
  async matches(input: string): Promise<boolean> {
    const record = this.read();
    if (!record || !input) return false;
    try {
      const candidate = await deriveKey(input, fromBase64(record.salt), record);
      return sameBytes(candidate, fromBase64(record.hash));
    } catch {
      return false;
    }
  }

  remove(): void {
    try {
      localStorage.removeItem(DURESS_KEY);
    } catch {
      // ignore
    }
  }
}
