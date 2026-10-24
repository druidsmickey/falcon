import { Injectable, inject } from '@angular/core';
import Dexie, { Table } from 'dexie';
import { Bet } from '../models';
import { VaultService } from '../security/vault.service';

export type OutboxType = 'create-bet' | 'save-params' | 'save-meeting-races';
export type OutboxStatus = 'pending' | 'conflict' | 'failed';

/**
 * One waiting save. Everything that says what was saved (`payload`) is encrypted with the vault; the
 * rest (kind, status, counts) is needed to show the sync state while the vault is locked and says nothing
 * about the data.
 */
export interface OutboxItem {
  id?: number;
  type: OutboxType;
  payload: unknown;
  createdAt: string;
  attempts: number;
  status: OutboxStatus;
  lastError?: string;
}

/** The name the outbox payloads are sealed under (they are bound to it, like every vault value). */
const PAYLOAD_NAME = 'outbox';

class OfflineDb extends Dexie {
  outbox!: Table<OutboxItem, number>;

  constructor() {
    super('itb-offline');
    this.version(1).stores({
      outbox: '++id, type, createdAt'
    });
    this.version(2).stores({
      outbox: '++id, type, status, createdAt'
    });
  }
}

@Injectable({ providedIn: 'root' })
export class OfflineStoreService {
  private db = new OfflineDb();
  private vault = inject(VaultService);

  generateRequestId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    const rand = Math.random().toString(36).slice(2);
    return `req_${Date.now()}_${rand}`;
  }

  private async queue(type: OutboxType, payload: unknown): Promise<void> {
    const item: OutboxItem = {
      type,
      payload: this.vault.seal(PAYLOAD_NAME, payload),
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending'
    };
    await this.db.outbox.add(item);
  }

  queueBet(payload: unknown): Promise<void> {
    return this.queue('create-bet', payload);
  }

  queueParams(payload: unknown): Promise<void> {
    return this.queue('save-params', payload);
  }

  queueMeetingRaces(payload: unknown): Promise<void> {
    return this.queue('save-meeting-races', payload);
  }

  /**
   * The waiting items with their payload opened. Items that cannot be opened (the vault is locked, or the
   * item is damaged) are left out. Items written by an older version in plain text are encrypted now.
   */
  async getPendingItems(): Promise<OutboxItem[]> {
    const items: OutboxItem[] = await this.db.outbox.toArray();
    const result: OutboxItem[] = [];

    for (const item of items.filter(i => i.status === 'pending' || i.status === 'failed')) {
      if (typeof item.payload === 'string') {
        const payload = this.vault.open<unknown>(PAYLOAD_NAME, item.payload);
        if (payload !== null) result.push({ ...item, payload });
      } else if (item.payload !== undefined && this.vault.isUnlocked() && item.id !== undefined) {
        // written in plain text by an older version
        await this.db.outbox.update(item.id, { payload: this.vault.seal(PAYLOAD_NAME, item.payload) });
        result.push(item);
      }
    }

    return result.sort((a: OutboxItem, b: OutboxItem) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Bets queued while offline that have not reached the server yet (rejected ones are not included). */
  async getPendingBets(): Promise<Bet[]> {
    const items = await this.getPendingItems();
    return items.filter(item => item.type === 'create-bet').map(item => item.payload as Bet);
  }

  async markSynced(id: number): Promise<void> {
    await this.db.outbox.delete(id);
  }

  async markFailed(id: number, errorMessage: string): Promise<void> {
    const existing = await this.db.outbox.get(id);
    const attempts = (existing?.attempts || 0) + 1;
    await this.db.outbox.update(id, {
      attempts,
      status: 'failed',
      lastError: errorMessage
    });
  }

  async markConflict(id: number, errorMessage: string): Promise<void> {
    const existing = await this.db.outbox.get(id);
    const attempts = (existing?.attempts || 0) + 1;
    await this.db.outbox.update(id, {
      attempts,
      status: 'conflict',
      lastError: errorMessage
    });
  }

  /** The counts need no key, so they can be shown while the vault is locked. */
  async getStats(): Promise<{ pending: number; conflict: number; failed: number }> {
    const [pending, conflict, failed] = await Promise.all([
      this.db.outbox.where('status').equals('pending').count(),
      this.db.outbox.where('status').equals('conflict').count(),
      this.db.outbox.where('status').equals('failed').count(),
    ]);
    return { pending, conflict, failed };
  }

  /** How many saves still wait to be sent (whatever their state), without needing a key. */
  async countWaiting(): Promise<number> {
    return this.db.outbox.count();
  }

  /** Removes the whole queue from the device. */
  async deleteDatabase(): Promise<void> {
    await this.db.delete();
  }
}
