import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

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

// Logged out after this long without the app being used (idle, hidden tab, minimised,
// window left on another screen, PC asleep, browser closed...)
const IDLE_LIMIT = 4 * 60 * 1000;
// How often the limits are checked
const CHECK_INTERVAL = 15 * 1000;
// Activity is recorded at most this often
const ACTIVITY_THROTTLE = 5 * 1000;

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {
    this.initializeAuth();
    this.setupSessionTracking();
  }

  private initializeAuth(): void {
    if (!this.getToken()) return;

    if (this.isSessionOver()) {
      this.logout();
      return;
    }

    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      this.currentUserSubject.next(JSON.parse(userStr));
    }
    this.markActive();
  }

  private lastRecorded = 0;

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
    return this.isTokenExpired() || this.hasBeenIdleTooLong();
  }

  private markActive(): void {
    if (this.isLoggedIn()) {
      this.lastRecorded = Date.now();
      localStorage.setItem('lastActivity', this.lastRecorded.toString());
    }
  }

  private hasBeenIdleTooLong(): boolean {
    const last = parseInt(localStorage.getItem('lastActivity') || '', 10);
    // No record at all counts as idle: a token without activity cannot be trusted
    return Number.isNaN(last) || Date.now() - last > IDLE_LIMIT;
  }

  // The server stamps the token with an expiry time (1 hour after login)
  private isTokenExpired(): boolean {
    const token = this.getToken();
    if (!token) return true;

    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
    } catch {
      return true;
    }
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

  login(username: string, password: string): Observable<LoginResponse> {
    const appContext = this.inferAppContext();
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/login`, { username, password, appContext })
      .pipe(
        tap((response) => {
          localStorage.setItem('token', response.token);
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          localStorage.setItem('appContext', response.user?.appScope || appContext);
          this.markActive();
          this.currentUserSubject.next(response.user);
        })
      );
  }

  changePassword(
    currentPassword: string,
    newPassword: string
  ): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/change-password`, {
      currentPassword,
      newPassword,
    });
  }

  logout(): void {
    localStorage.clear();
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }
}
