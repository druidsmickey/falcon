import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { VAULT_HEADER_KEY, VAULT_KDF, VaultService } from './vault.service';

const FAST = { N: 1024, r: 8, p: 1 };

describe('VaultService', () => {
  let vault: VaultService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: VAULT_KDF, useValue: FAST }] });
    vault = TestBed.inject(VaultService);
  });

  afterEach(() => localStorage.clear());

  it('a new vault is open, and has stored only its locked header', async () => {
    expect(vault.hasVault()).toBe(false);
    await vault.create('correct horse');
    expect(vault.hasVault()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
    expect(Object.keys(localStorage)).toEqual([VAULT_HEADER_KEY]);
  });

  it('values come back after being stored', async () => {
    await vault.create('correct horse');
    vault.setItem('bets:ASCOT', [{ clientName: 'ANN', stake: 100 }]);
    expect(vault.getItem('bets:ASCOT')).toEqual([{ clientName: 'ANN', stake: 100 }]);
    expect(vault.getItem('missing')).toBeNull();
  });

  it('nothing readable is left in the browser storage', async () => {
    await vault.create('correct horse');
    vault.setItem('bets:ASCOT 2026', [{ clientName: 'SECRET CLIENT', horseName: 'DAMBUSTER' }]);
    vault.setItem('session', { user: { username: 'secretuser' } });

    const everything = JSON.stringify(Object.entries(localStorage));
    for (const secret of ['SECRET', 'CLIENT', 'DAMBUSTER', 'ASCOT', 'secretuser', 'correct horse', 'bets:']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('locking forgets the key: nothing can be read or written until it is unlocked again', async () => {
    await vault.create('correct horse');
    vault.setItem('a', 'secret value');
    vault.lock();

    expect(vault.isUnlocked()).toBe(false);
    expect(vault.getItem('a')).toBeNull();
    expect(vault.setItem('b', 'x')).toBe(false);
    expect(() => vault.seal('outbox', 'x')).toThrow();
    expect(vault.open('outbox', 'whatever')).toBeNull();

    expect(await vault.unlock('correct horse')).toBe(true);
    expect(vault.getItem('a')).toBe('secret value');
  });

  it('a wrong password does not open it', async () => {
    await vault.create('correct horse');
    vault.setItem('a', 1);
    vault.lock();

    expect(await vault.unlock('wrong horse')).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
    expect(vault.getItem('a')).toBeNull();
  });

  it('checkPassword tells right from wrong without opening or closing anything', async () => {
    await vault.create('correct horse');
    vault.lock();
    expect(await vault.checkPassword('correct horse')).toBe(true);
    expect(await vault.checkPassword('nope nope')).toBe(false);
    expect(vault.isUnlocked()).toBe(false);
  });

  it('changing the password keeps the data and the old password stops working', async () => {
    await vault.create('old password');
    vault.setItem('a', 'kept');
    await vault.changePassword('new password');
    vault.lock();

    expect(await vault.unlock('old password')).toBe(false);
    expect(await vault.unlock('new password')).toBe(true);
    expect(vault.getItem('a')).toBe('kept');
  });

  it('the password cannot be changed while locked', async () => {
    await vault.create('pw-pw-pw');
    vault.lock();
    await expect(vault.changePassword('other')).rejects.toThrow();
  });

  it('a new vault replaces the data of an old one', async () => {
    await vault.create('first one');
    vault.setItem('a', 'old data');
    await vault.create('second one');
    expect(vault.getItem('a')).toBeNull();
    expect(Object.keys(localStorage)).toEqual([VAULT_HEADER_KEY]);
  });

  it('destroying the vault removes the locked key and the data, so nothing can be opened again', async () => {
    await vault.create('correct horse');
    vault.setItem('a', 'secret');
    vault.destroy();

    expect(Object.keys(localStorage)).toEqual([]);
    expect(vault.isUnlocked()).toBe(false);
    expect(vault.hasVault()).toBe(false);
    expect(await vault.unlock('correct horse')).toBe(false);
  });

  it('values cannot be swapped between names or changed', async () => {
    await vault.create('correct horse');
    vault.setItem('first', 'one');
    vault.setItem('second', 'two');

    const names = Object.keys(localStorage).filter(k => k !== VAULT_HEADER_KEY);
    expect(names).toHaveLength(2);
    const [a, b] = names;
    const valueA = localStorage.getItem(a) as string;
    localStorage.setItem(a, localStorage.getItem(b) as string);
    localStorage.setItem(b, valueA);

    expect(vault.getItem('first')).toBeNull();
    expect(vault.getItem('second')).toBeNull();
  });

  it('plain text left by an older version is removed as soon as the vault opens', async () => {
    localStorage.setItem('token', 'old-token');
    localStorage.setItem('currentUser', '{"username":"x"}');
    localStorage.setItem('lastActivity', '1');
    localStorage.setItem('selectedWhatsAppGroup', 'g1');
    localStorage.setItem('itb-cache-v1:bets:M', '[{"clientName":"ANN"}]');
    localStorage.setItem('itb-offline-http-v1:http://x/api/bets', '[]');
    localStorage.setItem('appContext', 'detori');

    await vault.create('correct horse');

    expect(Object.keys(localStorage).sort()).toEqual(['appContext', VAULT_HEADER_KEY].sort());
  });

  it('clearData removes the stored values but keeps the vault', async () => {
    await vault.create('correct horse');
    vault.setItem('a', 1);
    vault.clearData();
    expect(vault.getItem('a')).toBeNull();
    expect(vault.hasVault()).toBe(true);
    expect(vault.isUnlocked()).toBe(true);
  });

  it('a damaged header counts as no vault', () => {
    localStorage.setItem(VAULT_HEADER_KEY, '{not json');
    expect(vault.hasVault()).toBe(false);
    localStorage.setItem(VAULT_HEADER_KEY, '{"v":2}');
    expect(vault.hasVault()).toBe(false);
  });

  it('sealed values for other storage (the offline queue) are bound to their name', async () => {
    await vault.create('correct horse');
    const sealed = vault.seal('outbox', { clientName: 'ANN' });
    expect(sealed).not.toContain('ANN');
    expect(vault.open('outbox', sealed)).toEqual({ clientName: 'ANN' });
    expect(vault.open('something-else', sealed)).toBeNull();
  });
});
