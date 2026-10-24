import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DURESS_KEY, DuressService } from './duress.service';
import { VAULT_KDF } from './vault.service';

describe('DuressService', () => {
  let duress: DuressService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: VAULT_KDF, useValue: { N: 1024, r: 8, p: 1 } }] });
    duress = TestBed.inject(DuressService);
  });

  afterEach(() => localStorage.clear());

  it('nothing matches until a code is set', async () => {
    expect(duress.isSet()).toBe(false);
    expect(await duress.matches('anything')).toBe(false);
    expect(await duress.matches('')).toBe(false);
  });

  it('the code matches, other text does not', async () => {
    await duress.set('open sesame');
    expect(duress.isSet()).toBe(true);
    expect(await duress.matches('open sesame')).toBe(true);
    expect(await duress.matches('open sesam')).toBe(false);
    expect(await duress.matches('Open Sesame')).toBe(false);
    expect(await duress.matches('')).toBe(false);
  });

  it('the code itself is not stored, and the stored name does not say what it is', async () => {
    await duress.set('open sesame');
    const stored = localStorage.getItem(DURESS_KEY) as string;
    expect(stored).not.toContain('open sesame');
    expect(stored).not.toContain('sesame');
    expect(stored).not.toContain('duress');
    expect(DURESS_KEY).not.toContain('duress');
  });

  it('setting a new code replaces the old one', async () => {
    await duress.set('first code');
    await duress.set('second code');
    expect(await duress.matches('first code')).toBe(false);
    expect(await duress.matches('second code')).toBe(true);
  });

  it('removing the code stops it matching', async () => {
    await duress.set('open sesame');
    duress.remove();
    expect(duress.isSet()).toBe(false);
    expect(await duress.matches('open sesame')).toBe(false);
  });

  it('an empty code is refused', async () => {
    await expect(duress.set('')).rejects.toThrow();
  });

  it('damaged stored data does not match and does not crash', async () => {
    localStorage.setItem(DURESS_KEY, '{broken');
    expect(duress.isSet()).toBe(false);
    expect(await duress.matches('x')).toBe(false);
    localStorage.setItem(DURESS_KEY, JSON.stringify({ v: 1, N: 1024, r: 8, p: 1, salt: '%%', hash: '%%' }));
    expect(await duress.matches('x')).toBe(false);
  });
});
