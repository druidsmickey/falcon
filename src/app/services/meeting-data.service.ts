import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Shared data service that caches selectedRaces, params, and bets
 * across all tab components. Avoids redundant API calls when switching tabs.
 *
 * Call invalidateBets() after placing/cancelling/deleting a bet.
 * Call invalidateParams() after changing params/winners.
 * Call invalidateAll() after changing/selecting a meeting.
 */
@Injectable({ providedIn: 'root' })
export class MeetingDataService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/api`;
  private cachePrefix = 'itb-cache-v1';

  // Cached promises – multiple callers share the same in-flight request
  private _selectedRaces: Promise<any[]> | null = null;
  private _params: Promise<any[]> | null = null;
  private _bets: Promise<any[]> | null = null;
  private _lastBet: Promise<any> | null = null;
  private _meetingName = this.readCache<string>('meetingName') || '';

  private cacheKey(name: string): string {
    return `${this.cachePrefix}:${name}`;
  }

  private writeCache(name: string, value: unknown): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.cacheKey(name), JSON.stringify(value));
    } catch {
      // Ignore storage quota/private mode errors; memory cache still works.
    }
  }

  private readCache<T>(name: string): T | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(this.cacheKey(name));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private isAuthenticated(): boolean {
    return !!localStorage.getItem('token');
  }

  /** Selected races (cached). */
  getSelectedRaces(): Promise<any[]> {
    if (!this._selectedRaces) {
      if (!this.isAuthenticated()) {
        const cached = this.readCache<any[]>('selectedRaces') || [];
        if (cached.length > 0 && cached[0]?.meetingName) {
          this._meetingName = cached[0].meetingName;
        }
        return Promise.resolve(cached);
      }
      this._selectedRaces = firstValueFrom(
        this.http.get<any[]>(`${this.apiUrl}/params/selected-races`)
      ).then(races => {
        if (races && races.length > 0) {
          this._meetingName = races[0].meetingName;
          this.writeCache('meetingName', this._meetingName);
        }
        const result = races || [];
        this.writeCache('selectedRaces', result);
        return result;
      }).catch(() => {
        const cached = this.readCache<any[]>('selectedRaces') || [];
        if (cached.length > 0 && cached[0]?.meetingName) {
          this._meetingName = cached[0].meetingName;
          this.writeCache('meetingName', this._meetingName);
        }
        return cached;
      });
    }
    return this._selectedRaces;
  }

  /** Params for the current meeting (cached). */
  async getParams(): Promise<any[]> {
    if (!this._meetingName) await this.getSelectedRaces();
    if (!this._params) {
      const key = `params:${this._meetingName || 'default'}`;
      if (!this.isAuthenticated()) {
        return this.readCache<any[]>(key) || [];
      }
      this._params = firstValueFrom(
        this.http.get<any[]>(
          `${this.apiUrl}/params?meetingName=${encodeURIComponent(this._meetingName)}`
        )
      ).then(p => {
        const result = p || [];
        this.writeCache(key, result);
        return result;
      }).catch(() => {
        return this.readCache<any[]>(key) || [];
      });
    }
    return this._params;
  }

  /** Bets for the current meeting (cached). */
  async getBets(): Promise<any[]> {
    if (!this._meetingName) await this.getSelectedRaces();
    if (!this._bets) {
      const key = `bets:${this._meetingName || 'default'}`;
      if (!this.isAuthenticated()) {
        return this.readCache<any[]>(key) || [];
      }
      this._bets = firstValueFrom(
        this.http.get<any[]>(
          `${this.apiUrl}/bets?meetingName=${encodeURIComponent(this._meetingName)}`
        )
      ).then(b => {
        const result = b || [];
        this.writeCache(key, result);
        return result;
      }).catch(() => {
        return this.readCache<any[]>(key) || [];
      });
    }
    return this._bets;
  }

  /** Last placed bet (cached). */
  getLastBet(): Promise<any> {
    if (!this._lastBet) {
      if (!this.isAuthenticated()) {
        return Promise.resolve(this.readCache<any>('lastBet'));
      }
      this._lastBet = firstValueFrom(
        this.http.get<any>(`${this.apiUrl}/bets/last`)
      ).then((value) => {
        this.writeCache('lastBet', value);
        return value;
      }).catch(() => {
        return this.readCache<any>('lastBet');
      });
    }
    return this._lastBet;
  }

  /** Currently cached meeting name. */
  getMeetingName(): string {
    return this._meetingName;
  }

  /** Invalidate bets + lastBet caches (call after placing / cancelling / deleting a bet). */
  invalidateBets(): void {
    this._bets = null;
    this._lastBet = null;
  }

  /** Add a local bet to cache for offline mode. */
  addLocalBet(bet: any): void {
    if (this._bets) {
      this._bets = this._bets.then(list => {
        const next = [bet, ...(list || [])];
        this.writeCache(`bets:${this._meetingName || 'default'}`, next);
        return next;
      });
    } else {
      const next = [bet];
      this.writeCache(`bets:${this._meetingName || 'default'}`, next);
      this._bets = Promise.resolve(next);
    }
    this.writeCache('lastBet', bet);
    this._lastBet = Promise.resolve(bet);
  }

  /** Invalidate params cache (call after saving params or toggling winner). */
  invalidateParams(): void {
    this._params = null;
  }

  /** Invalidate everything (call after meeting/race changes). */
  invalidateAll(): void {
    this._selectedRaces = null;
    this._params = null;
    this._bets = null;
    this._lastBet = null;
    this._meetingName = '';
  }

  /**
   * Pull fresh data from server into cache. Used by two-way sync
   * so app receives latest server state after sending offline writes.
   */
  async refreshFromServer(): Promise<{ races: number; params: number; bets: number; total: number }> {
    this.invalidateAll();

    const races = await this.getSelectedRaces();
    if (!races || races.length === 0) {
      return { races: 0, params: 0, bets: 0, total: 0 };
    }

    const [params, bets] = await Promise.all([
      this.getParams(),
      this.getBets(),
    ]);

    await this.getLastBet();

    const counts = {
      races: races.length,
      params: params?.length || 0,
      bets: bets?.length || 0,
      total: (races.length) + (params?.length || 0) + (bets?.length || 0)
    };

    return counts;
  }
}
