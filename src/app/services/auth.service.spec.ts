import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { DeviceWipeService } from '../security/device-wipe.service';
import { VAULT_HEADER_KEY, VAULT_KDF, VaultService } from '../security/vault.service';
import { OfflineStoreService } from './offline-store.service';

const MINUTE = 60 * 1000;

// A token whose payload carries an expiry (the signature is not checked in the browser)
function tokenExpiringIn(minutes: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor((Date.now() + minutes * MINUTE) / 1000) }));
  return `header.${payload}.signature`;
}

type Internals = { startSession(token: string | null, user: unknown, offline: boolean): void };

describe('AuthService session rules', () => {
  let service: AuthService;
  let vault: VaultService;
  let toLogin: number;
  let listeners: [string, EventListenerOrEventListenerObject, unknown][];
  let focused: boolean;
  let visible: boolean;

  // Moves the clock forward in steps, as the 15 second timer would run
  const wait = (minutes: number) => vi.advanceTimersByTime(minutes * MINUTE);
  const use = (event: string) => document.dispatchEvent(new Event(event));
  const user = { id: '1', username: 'ann' };

  // A fresh page: nothing in memory, the vault (made with a password earlier) is locked
  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: VAULT_KDF, useValue: { N: 1024, r: 8, p: 1 } },
        { provide: HttpClient, useValue: {} },
        { provide: DeviceWipeService, useValue: { wipeAndLeave: async () => undefined } },
        { provide: OfflineStoreService, useValue: { countWaiting: async () => 0, deleteDatabase: async () => undefined } },
      ],
    });
  }

  // Logs in the way AuthService does after the server accepted the password
  function login(token: string | null) {
    (service as unknown as Internals).startSession(token, user, token === null);
  }

  beforeEach(async () => {
    localStorage.clear();
    configure();
    vault = TestBed.inject(VaultService);
    await vault.create('correct horse'); // real timers: the key derivation needs them

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T10:00:00'));
    focused = true;
    visible = true;
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => (visible ? 'visible' : 'hidden'));

    // remember the listeners so that each test starts with a clean document
    listeners = [];
    const original = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type: string, fn: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      listeners.push([type, fn, options]);
      original(type, fn, options);
    });

    toLogin = 0;
    vi.spyOn(AuthService.prototype as unknown as { goToLogin(): void }, 'goToLogin').mockImplementation(() => { toLogin++; });
    service = TestBed.inject(AuthService);
    login(tokenExpiringIn(60));
  });

  afterEach(() => {
    listeners.forEach(([type, fn, options]) => document.removeEventListener(type, fn, options as boolean));
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it('stays logged in while the app is being used', () => {
    for (let i = 0; i < 12; i++) {
      wait(0.5);
      use('keydown');
    }
    expect(service.isLoggedIn()).toBe(true);
  });

  it('logs out after 4 minutes without use, even when the window is open and focused', () => {
    wait(3.5);
    expect(service.isLoggedIn()).toBe(true);
    wait(1);
    expect(service.isLoggedIn()).toBe(false);
    expect(toLogin).toBe(1);
  });

  it('a hidden tab or minimised window is logged out after 4 minutes', () => {
    visible = false;
    use('visibilitychange');
    wait(3.5);
    expect(service.isLoggedIn()).toBe(true);
    wait(1);
    expect(service.isLoggedIn()).toBe(false);
  });

  it('moving the mouse over a window that does not have focus does not keep it alive', () => {
    focused = false;
    for (let i = 0; i < 10; i++) {
      wait(0.5);
      use('mousemove');
    }
    expect(service.isLoggedIn()).toBe(false);
  });

  it('moving the mouse over the focused window keeps the session', () => {
    for (let i = 0; i < 20; i++) {
      wait(0.5);
      use('mousemove');
    }
    expect(service.isLoggedIn()).toBe(true);
  });

  it('a click always counts', () => {
    focused = false;
    for (let i = 0; i < 10; i++) {
      wait(0.5);
      use('click');
    }
    expect(service.isLoggedIn()).toBe(true);
  });

  it('the first touch after a long absence logs out instead of extending the session', () => {
    vi.setSystemTime(Date.now() + 30 * MINUTE); // the computer slept, no timer ran
    use('click');
    expect(service.isLoggedIn()).toBe(false);
  });

  it('coming back to the tab after a long absence logs out', () => {
    visible = false;
    vi.setSystemTime(Date.now() + 10 * MINUTE);
    visible = true;
    use('visibilitychange');
    expect(service.isLoggedIn()).toBe(false);
  });

  it('opening the app again (a reload) needs a new login, however soon', () => {
    configure();
    const reopened = TestBed.inject(AuthService);
    expect(reopened.isLoggedIn()).toBe(false);
    expect(reopened.getToken()).toBeNull();
  });

  it('logs out when the login has lasted its hour, even if the app is in constant use', () => {
    for (let i = 0; i < 59; i++) {
      wait(1);
      use('click');
    }
    expect(service.isLoggedIn()).toBe(true);
    wait(1.5);
    use('click');
    expect(service.isLoggedIn()).toBe(false);
  });

  it('a session without the server also ends after its hour', () => {
    login(null);
    for (let i = 0; i < 59; i++) {
      wait(1);
      use('click');
    }
    expect(service.isLoggedIn()).toBe(true);
    wait(1.5);
    use('click');
    expect(service.isLoggedIn()).toBe(false);
  });

  it('a token that cannot be read counts as expired', () => {
    login('not-a-token');
    wait(0.5);
    expect(service.isLoggedIn()).toBe(false);
  });

  it('the token is kept in memory only', () => {
    expect(service.getToken()).not.toBeNull();
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('header.');
    expect(JSON.stringify(Object.entries(sessionStorage))).not.toContain('header.');
  });

  it('logging out locks the app and goes to the login page, but keeps the encrypted data', () => {
    service.logout();
    expect(service.isLoggedIn()).toBe(false);
    expect(service.getToken()).toBeNull();
    expect(vault.isUnlocked()).toBe(false);
    expect(localStorage.getItem(VAULT_HEADER_KEY)).not.toBeNull();
    expect(toLogin).toBe(1);
  });
});
