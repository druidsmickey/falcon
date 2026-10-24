import { Component, signal, inject } from '@angular/core';

import { MatTabsModule } from '@angular/material/tabs';
import { Dataentry } from './dataentry/dataentry';
import { Single } from './single/single';
import { Chart } from './chart/chart';
import { ListdataComponent } from './list/list';
import { Winners } from './winners/winners';
import { Reports } from './reports/reports';
import { Params } from './params/params';
import { Init } from './init/init';
import { Merge } from './merge/merge';
import { ChangePassword } from './change-password/change-password';
import { DeviceSecurity } from './device-security/device-security';
import { Whatsapp } from './whatsapp/whatsapp';
import { WhatsappInbox } from './whatsapp-inbox/whatsapp-inbox';
import { AuthService } from './services/auth.service';
import { OfflineSyncService } from './services/offline-sync.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [MatTabsModule, Dataentry, Single, Chart, Whatsapp, ListdataComponent, Winners, Reports, Params, Init, Merge, ChangePassword, DeviceSecurity, WhatsappInbox],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('itb');
  protected readonly isOnline = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  protected readonly checkingConnection = signal(false);
  protected readonly auth = inject(AuthService);
  // Raising this number builds all the tabs again, so that they show the data that was just synced. A
  // page reload cannot be used for that: it would lock the app (the key lives in memory only).
  protected readonly refreshKey = signal(0);
  private offlineSync = inject(OfflineSyncService);
  protected readonly syncState = this.offlineSync.state;
  private connectivityTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.checkConnectivity();
      });

      window.addEventListener('offline', () => {
        this.isOnline.set(false);
      });

      this.checkConnectivity();
      this.connectivityTimer = setInterval(() => {
        this.checkConnectivity();
      }, 10000);

      window.addEventListener('itb-sync-refresh-needed', () => {
        // After a successful push and pull build the tabs again so that they render the latest server data.
        this.refreshKey.update(key => key + 1);
      });
    }

    this.offlineSync.start();
  }

  private async checkConnectivity(): Promise<void> {
    if (typeof window === 'undefined') return;

    if (!navigator.onLine) {
      this.isOnline.set(false);
      return;
    }

    this.checkingConnection.set(true);
    const hasInternet = await this.probeInternet();
    this.isOnline.set(hasInternet);
    this.checkingConnection.set(false);
  }

  // Online means the app can reach its own server (the one it saves to and syncs with), not just
  // the wider internet. ngsw-bypass keeps the service worker from answering with a saved copy.
  private async probeInternet(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(`${environment.apiUrl}/health?ngsw-bypass=true`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  onLogout() {
    this.auth.logout();
  }

  async onSyncNow() {
    if (!this.isOnline()) {
      alert('Connect to internet first, then press Sync Now.');
      return;
    }

    await this.offlineSync.syncNow();
  }

  formatSyncTime(value: string): string {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Never';
    return date.toLocaleString();
  }
}
