import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

const MINUTE = 60 * 1000;

// A token whose payload carries an expiry (the signature is not checked in the browser)
function tokenExpiringIn(minutes: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor((Date.now() + minutes * MINUTE) / 1000) }));
  return `header.${payload}.signature`;
}

describe('AuthService session rules', () => {
  let service: AuthService;
  let navigated: unknown[][];
  let listeners: [string, EventListenerOrEventListenerObject, unknown][];
  let focused: boolean;
  let visible: boolean;

  // Moves the clock forward in steps, as the 15 second timer would run
  const wait = (minutes: number) => vi.advanceTimersByTime(minutes * MINUTE);
  const use = (event: string) => document.dispatchEvent(new Event(event));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T10:00:00'));
    localStorage.clear();
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

    navigated = [];
    login(60);
  });

  afterEach(() => {
    listeners.forEach(([type, fn, options]) => document.removeEventListener(type, fn, options as boolean));
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  // Logs in the way AuthService.login does, then creates the service for the page
  function login(tokenMinutes: number) {
    localStorage.setItem('token', tokenExpiringIn(tokenMinutes));
    localStorage.setItem('lastActivity', Date.now().toString());
    service = new AuthService({} as never, { navigate: (...args: unknown[]) => navigated.push(args) } as never);
  }

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
    expect(navigated).toEqual([[['/login']]]);
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

  it('opening the app again after more than 4 minutes needs a new login', () => {
    vi.setSystemTime(Date.now() + 5 * MINUTE);
    const reopened = new AuthService({} as never, { navigate: () => undefined } as never);
    expect(reopened.isLoggedIn()).toBe(false);
  });

  it('logs out when the login has lasted its hour, even if the app is in constant use', () => {
    localStorage.clear();
    login(60);
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
    localStorage.setItem('token', 'not-a-token');
    wait(0.5);
    expect(service.isLoggedIn()).toBe(false);
  });

  it('logging out clears the saved data and goes to the login page', () => {
    localStorage.setItem('currentUser', '{"id":"1"}');
    service.logout();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('currentUser')).toBeNull();
    expect(navigated).toEqual([[['/login']]]);
  });
});
