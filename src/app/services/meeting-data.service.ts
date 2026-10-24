import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { Bet, BetRequest, HorseParam, SelectedRace } from '../models';
import { VaultService } from '../security/vault.service';
import { AuthService } from './auth.service';
import { OfflineStoreService } from './offline-store.service';

/** What happened to a bet that was sent with submitBet(). */
export type BetSubmitResult =
  | { status: 'saved' }
  | { status: 'queued' }
  | { status: 'rejected'; message: string };

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
  private offlineStore = inject(OfflineStoreService);
  private apiUrl = `${environment.apiUrl}/api`;
  private vault = inject(VaultService);
  private auth = inject(AuthService);

  // Cached promises – multiple callers share the same in-flight request
  private _selectedRaces: Promise<SelectedRace[]> | null = null;
  private _params: Promise<HorseParam[]> | null = null;
  private _bets: Promise<Bet[]> | null = null;
  private _lastBet: Promise<Bet | null> | null = null;
  // set when the races are read (the saved copy is encrypted and cannot be read before the login)
  private _meetingName = '';

  // The saved copy of the data lives in the encrypted vault, so it can only be read after logging in.
  private writeCache(name: string, value: unknown): void {
    this.vault.setItem(`cache:${name}`, value);
  }

  private readCache<T>(name: string): T | null {
    return this.vault.getItem<T>(`cache:${name}`);
  }

  /** True when the server can be used (a login token exists). Without one, only the saved copy is used. */
  private isAuthenticated(): boolean {
    return this.auth.hasToken();
  }

  /** Selected races (cached). */
  getSelectedRaces(): Promise<SelectedRace[]> {
    if (!this._selectedRaces) {
      if (!this.isAuthenticated()) {
        const cached = this.readCache<SelectedRace[]>('selectedRaces') || [];
        if (cached.length > 0 && cached[0]?.meetingName) {
          this._meetingName = cached[0].meetingName;
        }
        return Promise.resolve(cached);
      }
      this._selectedRaces = firstValueFrom(
        this.http.get<SelectedRace[]>(`${this.apiUrl}/params/selected-races`)
      ).then(races => {
        if (races && races.length > 0) {
          this._meetingName = races[0].meetingName;
          this.writeCache('meetingName', this._meetingName);
        }
        const result = races || [];
        this.writeCache('selectedRaces', result);
        return result;
      }).catch(() => {
        const cached = this.readCache<SelectedRace[]>('selectedRaces') || [];
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
  async getParams(): Promise<HorseParam[]> {
    if (!this._meetingName) await this.getSelectedRaces();
    if (!this._params) {
      const key = `params:${this._meetingName || 'default'}`;
      if (!this.isAuthenticated()) {
        return this.readCache<HorseParam[]>(key) || [];
      }
      this._params = firstValueFrom(
        this.http.get<HorseParam[]>(
          `${this.apiUrl}/params?meetingName=${encodeURIComponent(this._meetingName)}`
        )
      ).then(p => {
        const result = p || [];
        this.writeCache(key, result);
        return result;
      }).catch(() => {
        return this.readCache<HorseParam[]>(key) || [];
      });
    }
    return this._params;
  }

  /** Bets for the current meeting (cached). */
  async getBets(): Promise<Bet[]> {
    if (!this._meetingName) await this.getSelectedRaces();
    if (!this._bets) {
      const key = `bets:${this._meetingName || 'default'}`;
      if (!this.isAuthenticated()) {
        return this.withPendingBets(this.readCache<Bet[]>(key) || []);
      }
      this._bets = firstValueFrom(
        this.http.get<Bet[]>(
          `${this.apiUrl}/bets?meetingName=${encodeURIComponent(this._meetingName)}`
        )
      ).then(b => {
        const result = b || [];
        // only what the server sent is saved; bets still waiting to be sent are added when reading
        this.writeCache(key, result);
        return result;
      }).catch(() => {
        return this.readCache<Bet[]>(key) || [];
      }).then(list => this.withPendingBets(list));
    }
    return this._bets;
  }

  /** Last placed bet (cached). */
  getLastBet(): Promise<Bet | null> {
    if (!this._lastBet) {
      if (!this.isAuthenticated()) {
        return this.latestWithPending(this.readCache<Bet | null>('lastBet'));
      }
      this._lastBet = firstValueFrom(
        this.http.get<Bet | null>(`${this.apiUrl}/bets/last`)
      ).then((value) => {
        this.writeCache('lastBet', value);
        return value;
      }).catch(() => {
        return this.readCache<Bet | null>('lastBet');
      }).then(value => this.latestWithPending(value));
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

  /**
   * Show a bet that is waiting to be sent in the lists and charts straight away.
   * It is not written to the saved copy: while it waits it is read from the outbox (see withPendingBets).
   */
  addLocalBet(newBet: BetRequest): void {
    // the entry screens have filled in books, stake and payout before the bet is saved
    const bet = newBet as Bet;
    const others = (list: Bet[]) => list.filter(b => !b.clientRequestId || b.clientRequestId !== bet.clientRequestId);

    const current = this._bets ?? this.withPendingBets(this.readCache<Bet[]>(`bets:${this._meetingName || 'default'}`) || []);
    this._bets = current.then(list => [bet, ...others(list || [])]);
    this._lastBet = Promise.resolve(bet);
    this.writeCache('lastBet', bet);
  }

  /**
   * Send a bet. If the server cannot be reached, or answers with a server fault, the bet is kept
   * in the outbox and sent later (the request id stops it being stored twice). A bet the server
   * refuses as invalid (4xx) is reported, because sending it again would not help.
   */
  async submitBet(bet: BetRequest): Promise<BetSubmitResult> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await this.queueBet(bet);
      return { status: 'queued' };
    }

    try {
      await firstValueFrom(this.http.post(`${this.apiUrl}/bets`, bet));
      this.invalidateBets();
      return { status: 'saved' };
    } catch (error) {
      const failure = error as HttpErrorResponse;
      if (failure.status === 0 || failure.status >= 500) {
        await this.queueBet(bet);
        return { status: 'queued' };
      }
      return { status: 'rejected', message: failure.error?.error || failure.message };
    }
  }

  private async queueBet(bet: BetRequest): Promise<void> {
    await this.offlineStore.queueBet(bet);
    this.addLocalBet(bet);
  }

  /** The saved bets of the current meeting plus the ones still waiting in the outbox, newest first. */
  private async withPendingBets(list: Bet[]): Promise<Bet[]> {
    try {
      const pending = (await this.offlineStore.getPendingBets()).filter(b => b.meetingName === this._meetingName);
      if (pending.length === 0) return list;

      const known = new Set(list.map(b => b.clientRequestId).filter(Boolean));
      const waiting = pending
        .filter(b => !b.clientRequestId || !known.has(b.clientRequestId))
        .sort((x, y) => new Date(y.betTime).getTime() - new Date(x.betTime).getTime());
      return [...waiting, ...list];
    } catch {
      return list;
    }
  }

  /** The newest of the last saved bet and the bets still waiting in the outbox. */
  private async latestWithPending(saved: Bet | null): Promise<Bet | null> {
    try {
      const pending = await this.offlineStore.getPendingBets();
      return pending.reduce<Bet | null>(
        (latest, bet) => (!latest || new Date(bet.betTime).getTime() > new Date(latest.betTime).getTime() ? bet : latest),
        saved
      );
    } catch {
      return saved;
    }
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
