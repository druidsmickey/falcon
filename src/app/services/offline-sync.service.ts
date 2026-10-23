import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { OfflineStoreService } from './offline-store.service';
import { MeetingDataService } from './meeting-data.service';

@Injectable({ providedIn: 'root' })
export class OfflineSyncService {
  private http = inject(HttpClient);
  private store = inject(OfflineStoreService);
  private meetingData = inject(MeetingDataService);
  private apiUrl = `${environment.apiUrl}/api`;
  private isSyncing = false;
  private syncState = signal({
    pending: 0,
    conflict: 0,
    failed: 0,
    syncing: false,
    lastSyncedAt: '',
    lastMessage: 'Not synced yet',
    lastSentCount: 0,
    lastAttemptAt: ''
  });

  readonly state = this.syncState.asReadonly();

  start(): void {
    if (typeof window === 'undefined') return;

    this.refreshState();
    this.syncOnce();

    window.addEventListener('online', () => {
      this.syncOnce();
    });

    // Periodic retry every 30s when online
    setInterval(() => {
      if (navigator.onLine) {
        this.syncOnce();
      } else {
        this.refreshState();
      }
    }, 30000);
  }

  async syncNow(): Promise<void> {
    await this.syncOnce();
  }

  private async refreshState(): Promise<void> {
    const stats = await this.store.getStats();
    this.syncState.update((current) => ({
      ...current,
      pending: stats.pending,
      conflict: stats.conflict,
      failed: stats.failed
    }));
  }

  async syncOnce(): Promise<void> {
    if (this.isSyncing) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    this.isSyncing = true;
    this.syncState.update((current) => ({
      ...current,
      syncing: true,
      lastAttemptAt: new Date().toISOString(),
      lastMessage: 'Sync in progress...'
    }));

    let sentCount = 0;
    let failedCount = 0;
    let conflictCount = 0;
    let pulledCount = 0;
    let pullOk = false;

    try {
      const pending = await this.store.getPendingItems();

      if (pending.length === 0) {
        this.syncState.update((current) => ({
          ...current,
          lastMessage: 'No pending items to sync',
          lastSentCount: 0
        }));
      }

      for (const item of pending) {
        try {
          if (item.type === 'create-bet') {
            await this.http.post(`${this.apiUrl}/bets`, item.payload).toPromise();
            this.meetingData.invalidateBets();
          } else if (item.type === 'save-params') {
            await this.http.post(`${this.apiUrl}/params`, item.payload).toPromise();
            this.meetingData.invalidateParams();
          } else if (item.type === 'save-meeting-races') {
            await this.http.post(`${this.apiUrl}/meetings/races`, item.payload).toPromise();
            this.meetingData.invalidateAll();
          }

          if (item.id != null) {
            await this.store.markSynced(item.id);
            sentCount += 1;
          }
        } catch (error: any) {
          const status = error?.status;
          const message = error?.error?.error || error?.message || 'Sync failed';
          if (item.id != null) {
            if (status === 409) {
              await this.store.markConflict(item.id, message);
              conflictCount += 1;
            } else {
              await this.store.markFailed(item.id, message);
              failedCount += 1;
            }
          }
        }
      }

      // Pull latest server state into shared cache after push phase
      try {
        const pullStats = await this.meetingData.refreshFromServer();
        pulledCount = pullStats.total;
        pullOk = true;
      } catch {
        pullOk = false;
      }
    } finally {
      this.isSyncing = false;
      await this.refreshState();

      let summary = 'Sync finished';
      if (!pullOk) {
        summary = `Sync issue: send phase finished, but fetch from server failed`;
      } else if (sentCount > 0 && failedCount === 0 && conflictCount === 0) {
        summary = `Sync successful: sent ${sentCount}, fetched ${pulledCount}`;
      } else if (sentCount > 0) {
        summary = `Sync partial: sent ${sentCount}, fetched ${pulledCount}, conflicts ${conflictCount}, failed ${failedCount}`;
      } else if (conflictCount > 0 || failedCount > 0) {
        summary = `Sync issue: fetched ${pulledCount}, conflicts ${conflictCount}, failed ${failedCount}`;
      } else {
        summary = `Sync up to date: sent 0, fetched ${pulledCount}`;
      }

      if (pullOk && sentCount > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('itb-sync-refresh-needed'));
      }

      this.syncState.update((current) => ({
        ...current,
        syncing: false,
        lastSyncedAt: new Date().toISOString(),
        lastMessage: summary,
        lastSentCount: sentCount
      }));
    }
  }
}
