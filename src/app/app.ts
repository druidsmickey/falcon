import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { Email } from './email/email';
import { Whatsapp } from './whatsapp/whatsapp';
import { AuthService } from './services/auth.service';
import { OfflineSyncService } from './services/offline-sync.service';

@Component({
  selector: 'app-root',
  imports: [CommonModule, MatTabsModule, Dataentry, Single, Chart, Whatsapp, ListdataComponent, Winners, Reports, Params, Init, Merge, ChangePassword, Email],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('itb');
  protected readonly isOnline = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  protected readonly checkingConnection = signal(false);
  private auth = inject(AuthService);
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
        // Reload once after successful push+pull so all tabs render latest server data.
        window.location.reload();
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

  private async probeInternet(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);

      await fetch('https://www.gstatic.com/generate_204', {
        method: 'GET',
        cache: 'no-store',
        mode: 'no-cors',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return true;
    } catch {
      return false;
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
