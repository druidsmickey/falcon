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

// Logged out when the app has not been in front of the user for this long
const AWAY_LIMIT = 4 * 60 * 1000;
// How often the app records that it is being used, and checks the limits
const HEARTBEAT_INTERVAL = 15 * 1000;

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
    this.markSeen();
  }

  private setupSessionTracking(): void {
    document.addEventListener('visibilitychange', () => this.heartbeat());
    window.addEventListener('focus', () => this.heartbeat());
    setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL);
  }

  // Runs on a timer and whenever the user comes back to the app. The limits are checked
  // before the "last seen" time is refreshed, so coming back after a long absence
  // (hidden tab, sleeping PC) ends the session instead of extending it.
  private heartbeat(): void {
    if (!this.isLoggedIn()) return;

    if (this.isSessionOver()) {
      this.logout();
      return;
    }

    if (document.visibilityState === 'visible') {
      this.markSeen();
    }
  }

  // Session is over when the login has expired (1 hour) or the app was not in use for AWAY_LIMIT
  private isSessionOver(): boolean {
    return this.isTokenExpired() || this.hasBeenAwayTooLong();
  }

  private markSeen(): void {
    if (this.isLoggedIn()) {
      localStorage.setItem('lastSeen', Date.now().toString());
    }
  }

  private hasBeenAwayTooLong(): boolean {
    const lastSeen = parseInt(localStorage.getItem('lastSeen') || '', 10);
    return !Number.isNaN(lastSeen) && Date.now() - lastSeen > AWAY_LIMIT;
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
          this.markSeen();
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
