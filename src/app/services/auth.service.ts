import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, firstValueFrom, from } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { DeviceWipeService } from '../security/device-wipe.service';
import { DuressService } from '../security/duress.service';
import { VaultService } from '../security/vault.service';
import { OfflineStoreService } from './offline-store.service';

export interface User {
  id: string;
  username: string;
  appScope?: string;
}

export interface LoginResponse {
  message: string;
  token: string;
  user: User;
}

/** What the login page has to do after a sign-in attempt. */
export type SignInResult =
  /** Logged in on the server; the vault is open. */
  | { status: 'ok' }
  /** The server cannot be reached; the saved data on this device was opened with the password. */
  | { status: 'offline' }
  /** The duress code was typed: the device is being wiped and the page is leaving for the game. */
  | { status: 'duress' }
  /** Wrong user name or password. */
  | { status: 'invalid'; message: string }
  /** The server cannot be reached and there is no saved data on this device. */
  | { status: 'unreachable'; message: string }
  /** The password was changed elsewhere, so the saved data on this device is still locked with the old one. */
  | { status: 'old-password-needed' };

interface SessionInfo {
  user: User;
}

// Logged out after this long without the app being used (idle, hidden tab, minimised,
// window left on another screen, PC asleep...)
const IDLE_LIMIT = 4 * 60 * 1000;
// A login lasts one hour (the server's token says the same)
const SESSION_LIMIT = 60 * 60 * 1000;
// How often the limits are checked
const CHECK_INTERVAL = 15 * 1000;
// Activity is recorded at most this often
const ACTIVITY_THROTTLE = 5 * 1000;

/**
 * Logging in, locking and the session rules.
 *
 * The login token and the data key live in memory only. Logging out, being idle for 4 minutes, reloading
 * the page or closing it all forget them, and the data on the device can then only be opened again with
 * the password (see VaultService). The password is also the key of the vault, so a device that cannot
 * reach the server can still be unlocked with it.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private vault = inject(VaultService);
  private duress = inject(DuressService);
  private wipe = inject(DeviceWipeService);
  private offlineStore = inject(OfflineStoreService);

  private apiUrl = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser = this.currentUserSubject.asObservable();

  private token: string | null = null;
  private offlineSession = false;
  private signedInAt = 0;
  private lastActive = Date.now();
  private lastRecorded = 0;
  private pendingLogin: { password: string; response: LoginResponse } | null = null;

  constructor() {
    this.setupSessionTracking();
  }

  // ---------------------------------------------------------------- state

  /** True while the vault is open, that is, someone has logged in on this page. */
  isLoggedIn(): boolean {
    return this.vault.isUnlocked();
  }

  /** The token for the server, or null (not logged in, or working offline from the saved data). */
  getToken(): string | null {
    return this.token;
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  /** True when the vault was opened without the server (working from the saved data). */
  isOfflineSession(): boolean {
    return this.offlineSession;
  }

  private inferAppContext(): string {
    if (typeof window === 'undefined') {
      return 'default';
    }

    const source = `${window.location.hostname} ${window.location.href}`.toLowerCase();
    if (source.includes('phantom')) return 'phantom';
    if (source.includes('detori')) return 'detori';
    return localStorage.getItem('appContext') || 'default';
  }

  getCurrentAppContext(): string {
    return this.inferAppContext();
  }

  // ---------------------------------------------------------------- signing in

  async signIn(username: string, password: string): Promise<SignInResult> {
    // The duress code is recognised here, on the device, before anything is sent anywhere.
    if (await this.duress.matches(password)) {
      await this.wipe.wipeAndLeave();
      return { status: 'duress' };
    }

    const appContext = this.inferAppContext();
    let response: LoginResponse;
    try {
      response = await firstValueFrom(
        this.http.post<LoginResponse>(`${this.apiUrl}/login`, { username, password, appContext })
      );
    } catch (error) {
      const failure = error as HttpErrorResponse;
      if (failure.status === 0 || failure.status >= 500) {
        return this.signInWithoutServer(username, password);
      }
      return { status: 'invalid', message: failure.error?.message || 'Login failed. Please try again.' };
    }

    localStorage.setItem('appContext', response.user?.appScope || appContext);
    return this.finishOnlineSignIn(password, response);
  }

  private async finishOnlineSignIn(password: string, response: LoginResponse): Promise<SignInResult> {
    if (!this.vault.hasVault()) {
      await this.vault.create(password);
    } else if (!(await this.vault.unlock(password))) {
      // The saved data is locked with another password (it was changed elsewhere), or is not ours.
      if ((await this.offlineStore.countWaiting()) === 0) {
        await this.vault.create(password); // nothing unsent to lose: start again
      } else {
        this.pendingLogin = { password, response };
        return { status: 'old-password-needed' };
      }
    }

    // saved data of another user is not shown to this one
    const saved = this.vault.getItem<SessionInfo>('session');
    if (saved && saved.user.username.toLowerCase() !== response.user.username.toLowerCase()) {
      this.vault.clearData();
    }

    this.startSession(response.token, response.user, false);
    return { status: 'ok' };
  }

  private async signInWithoutServer(username: string, password: string): Promise<SignInResult> {
    if (!this.vault.hasVault()) {
      return { status: 'unreachable', message: 'The server cannot be reached, and there is no saved data on this device yet.' };
    }
    if (!(await this.vault.unlock(password))) {
      return { status: 'invalid', message: 'The server cannot be reached, and that password does not open the saved data.' };
    }

    const saved = this.vault.getItem<SessionInfo>('session');
    if (!saved || saved.user.username.toLowerCase() !== username.trim().toLowerCase()) {
      this.vault.lock();
      return { status: 'invalid', message: 'The server cannot be reached, and the saved data on this device belongs to another user.' };
    }

    this.startSession(null, saved.user, true);
    return { status: 'offline' };
  }

  /** The password was changed elsewhere: the old one keeps the unsent bets. */
  async continueWithOldPassword(oldPassword: string): Promise<SignInResult> {
    const pending = this.pendingLogin;
    if (!pending) return { status: 'invalid', message: 'Please log in again.' };
    if (!(await this.vault.unlock(oldPassword))) {
      return { status: 'invalid', message: 'That is not the previous password.' };
    }
    await this.vault.changePassword(pending.password);
    this.pendingLogin = null;
    this.startSession(pending.response.token, pending.response.user, false);
    return { status: 'ok' };
  }

  /** The password was changed elsewhere and the old one is not known: the unsent bets are given up. */
  async discardSavedDataAndContinue(): Promise<SignInResult> {
    const pending = this.pendingLogin;
    if (!pending) return { status: 'invalid', message: 'Please log in again.' };
    await this.offlineStore.deleteDatabase();
    await this.vault.create(pending.password);
    this.pendingLogin = null;
    this.startSession(pending.response.token, pending.response.user, false);
    return { status: 'ok' };
  }

  private startSession(token: string | null, user: User, offline: boolean): void {
    this.token = token;
    this.offlineSession = offline;
    this.signedInAt = Date.now();
    this.vault.setItem('session', { user } satisfies SessionInfo);
    this.currentUserSubject.next(user);
    this.markActive();
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http
      .post<{ message: string }>(`${this.apiUrl}/change-password`, { currentPassword, newPassword })
      .pipe(
        // the saved data on this device is locked with the new password from now on
        switchMap(response => from(this.vault.changePassword(newPassword)).pipe(map(() => response)))
      );
  }

  /** Locks the app: forgets the token and the data key and returns to the login page. */
  logout(): void {
    this.vault.lock();
    this.token = null;
    this.offlineSession = false;
    this.currentUserSubject.next(null);
    this.goToLogin();
  }

  /** A new page load, so that nothing from the session stays in memory. */
  protected goToLogin(): void {
    window.location.assign(new URL('login', document.baseURI).href);
  }

  // ---------------------------------------------------------------- session rules

  private setupSessionTracking(): void {
    // Real use of the app: a click, tap, key press... always counts because it focuses the window.
    // Moving the mouse or scrolling only counts while the window has focus, so a window left
    // visible on a second screen is not kept alive by the pointer passing over it.
    const always = ['pointerdown', 'mousedown', 'click', 'keydown', 'touchstart', 'input'];
    const onlyWithFocus = ['mousemove', 'wheel', 'scroll', 'touchmove'];

    always.forEach(name => document.addEventListener(name, () => this.onActivity(), { passive: true, capture: true }));
    onlyWithFocus.forEach(name =>
      document.addEventListener(name, () => { if (document.hasFocus()) this.onActivity(); }, { passive: true, capture: true })
    );

    // Coming back (tab shown, window focused, PC woken) only checks the limits, it never extends the session
    document.addEventListener('visibilitychange', () => this.checkSession());
    window.addEventListener('focus', () => this.checkSession());
    setInterval(() => this.checkSession(), CHECK_INTERVAL);
  }

  private onActivity(): void {
    if (!this.isLoggedIn()) return;

    // The limits are checked before the activity time is refreshed, so the first touch after a
    // long absence ends the session instead of extending it.
    if (this.isSessionOver()) {
      this.logout();
      return;
    }

    if (Date.now() - this.lastRecorded > ACTIVITY_THROTTLE) {
      this.markActive();
    }
  }

  private checkSession(): void {
    if (this.isLoggedIn() && this.isSessionOver()) {
      this.logout();
    }
  }

  // Session is over when the login has expired (1 hour) or the app was not used for IDLE_LIMIT
  private isSessionOver(): boolean {
    return this.isLoginExpired() || Date.now() - this.lastActive > IDLE_LIMIT;
  }

  private markActive(): void {
    this.lastRecorded = Date.now();
    this.lastActive = this.lastRecorded;
  }

  // The server stamps the token with an expiry time (1 hour after login); without a token the hour
  // is counted from signing in
  private isLoginExpired(): boolean {
    if (!this.token) return Date.now() - this.signedInAt > SESSION_LIMIT;

    try {
      const payload = JSON.parse(atob(this.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
    } catch {
      return true;
    }
  }
}
