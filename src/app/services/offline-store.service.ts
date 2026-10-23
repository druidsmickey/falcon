import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

export type OutboxType = 'create-bet' | 'save-params' | 'save-meeting-races';
export type OutboxStatus = 'pending' | 'conflict' | 'failed';

export interface OutboxItem {
  id?: number;
  type: OutboxType;
  payload: any;
  createdAt: string;
  attempts: number;
  status: OutboxStatus;
  lastError?: string;
}

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

  generateRequestId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    const rand = Math.random().toString(36).slice(2);
    return `req_${Date.now()}_${rand}`;
  }

  async queueBet(payload: any): Promise<void> {
    const item: OutboxItem = {
      type: 'create-bet',
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending'
    };
    await this.db.outbox.add(item);
  }

  async queueParams(payload: any): Promise<void> {
    const item: OutboxItem = {
      type: 'save-params',
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending'
    };
    await this.db.outbox.add(item);
  }

  async queueMeetingRaces(payload: any): Promise<void> {
    const item: OutboxItem = {
      type: 'save-meeting-races',
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: 'pending'
    };
    await this.db.outbox.add(item);
  }

  async getPendingItems(): Promise<OutboxItem[]> {
    const items: OutboxItem[] = await this.db.outbox.toArray();
    return items
      .filter((item: OutboxItem) => item.status === 'pending' || item.status === 'failed')
      .sort((a: OutboxItem, b: OutboxItem) => a.createdAt.localeCompare(b.createdAt));
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

  async getStats(): Promise<{ pending: number; conflict: number; failed: number }> {
    const [pending, conflict, failed] = await Promise.all([
      this.db.outbox.where('status').equals('pending').count(),
      this.db.outbox.where('status').equals('conflict').count(),
      this.db.outbox.where('status').equals('failed').count(),
    ]);
    return { pending, conflict, failed };
  }
}
