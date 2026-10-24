import { Injectable, inject } from '@angular/core';
import { OfflineStoreService } from '../services/offline-store.service';
import { DURESS_KEY } from './duress.service';
import { VaultService } from './vault.service';

/** The two things that stay: the check of the duress code, and which app (Phantom / Detori) this is. */
const KEPT_KEYS = [DURESS_KEY, 'appContext'];

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([work, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))]);

/**
 * Removes everything this app stored on the device: the vault (its locked key first, so that anything
 * left behind on the disk is unreadable), the saved data, the offline queue, the saved app files and the
 * service worker. The data on the server is not touched; logging in again downloads it again.
 */
@Injectable({ providedIn: 'root' })
export class DeviceWipeService {
  private vault = inject(VaultService);
  private offlineStore = inject(OfflineStoreService);

  async wipe(): Promise<void> {
    const kept = KEPT_KEYS.map(key => [key, this.read(key)] as const);

    // 1. the locked key: from here on nothing stored can be read, even if a later step fails
    this.vault.destroy();

    // 2. everything in the browser's simple storage
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore
    }
    for (const [key, value] of kept) {
      if (value !== null) this.write(key, value);
    }
    this.clearCookies();

    // 3. the rest, each with a time limit so that one stuck step cannot stop the others
    await Promise.allSettled([
      withTimeout(this.deleteDatabases(), 2500),
      withTimeout(this.deleteCaches(), 2500),
      withTimeout(this.unregisterWorkers(), 2500),
    ]);
  }

  /**
   * Wipes, then leaves the page (for the game by default). A new page load also clears everything held in memory.
   */
  async wipeAndLeave(path = 'arcade'): Promise<void> {
    await this.wipe();
    this.goTo(path);
  }

  /** Goes to another page of the app with a fresh page load (replaces the history entry). */
  protected goTo(path: string): void {
    window.location.replace(new URL(path, document.baseURI).href);
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }

  private clearCookies(): void {
    try {
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.split('=')[0].trim();
        if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
      }
    } catch {
      // ignore
    }
  }

  private async deleteDatabases(): Promise<void> {
    await this.offlineStore.deleteDatabase();
    const listed = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    await Promise.allSettled(
      listed.map(
        db =>
          new Promise<void>(resolve => {
            if (!db.name) return resolve();
            const request = indexedDB.deleteDatabase(db.name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          })
      )
    );
  }

  private async deleteCaches(): Promise<void> {
    if (typeof caches === 'undefined') return;
    await Promise.allSettled((await caches.keys()).map(name => caches.delete(name)));
  }

  private async unregisterWorkers(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    await Promise.allSettled((await navigator.serviceWorker.getRegistrations()).map(reg => reg.unregister()));
  }
}
