import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { IDBKeyRange as fakeKeyRange, indexedDB as fakeIndexedDb } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DURESS_KEY, DuressService } from './duress.service';
import { DeviceWipeService } from './device-wipe.service';
import { VAULT_HEADER_KEY, VAULT_KDF, VaultService } from './vault.service';
import { OfflineStoreService } from '../services/offline-store.service';

// Dexie may have been loaded before the fake database was installed
Dexie.dependencies.indexedDB = fakeIndexedDb;
Dexie.dependencies.IDBKeyRange = fakeKeyRange;

describe('DeviceWipeService', () => {
  let wipe: DeviceWipeService;
  let vault: VaultService;
  let duress: DuressService;
  let store: OfflineStoreService;

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: VAULT_KDF, useValue: { N: 1024, r: 8, p: 1 } }] });
    wipe = TestBed.inject(DeviceWipeService);
    vault = TestBed.inject(VaultService);
    duress = TestBed.inject(DuressService);
    store = TestBed.inject(OfflineStoreService);

    // a device with something on it
    await vault.create('real password');
    vault.setItem('cache:bets:ASCOT', [{ clientName: 'SECRET CLIENT' }]);
    vault.setItem('session', { user: { username: 'secretuser' } });
    await duress.set('duress code');
    localStorage.setItem('appContext', 'detori');
    localStorage.setItem('left-behind', 'something else');
    sessionStorage.setItem('tab', 'data');
    await store.queueBet({ clientName: 'SECRET CLIENT', stake: 100 });
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('removes everything from the browser storage except the duress check and the app name', async () => {
    await wipe.wipe();
    expect(Object.keys(localStorage).sort()).toEqual(['appContext', DURESS_KEY].sort());
    expect(sessionStorage.length).toBe(0);
  });

  it('the vault is gone: the real password opens nothing any more', async () => {
    await wipe.wipe();
    expect(localStorage.getItem(VAULT_HEADER_KEY)).toBeNull();
    expect(vault.isUnlocked()).toBe(false);
    expect(vault.hasVault()).toBe(false);
    expect(await vault.unlock('real password')).toBe(false);
    expect(vault.getItem('cache:bets:ASCOT')).toBeNull();
  });

  it('the offline queue is deleted from the database', async () => {
    expect(await store.countWaiting()).toBe(1);
    await wipe.wipe();
    const databases = await indexedDB.databases();
    expect(databases.map(d => d.name)).not.toContain('itb-offline');
  });

  it('nothing readable is left anywhere in the browser', async () => {
    await wipe.wipe();
    const everything = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
    for (const secret of ['SECRET', 'secretuser', 'ASCOT', 'real password', 'duress code', 'left-behind', 'something else']) {
      expect(everything).not.toContain(secret);
    }
  });

  it('the duress code keeps working after a wipe', async () => {
    await wipe.wipe();
    expect(duress.isSet()).toBe(true);
    expect(await duress.matches('duress code')).toBe(true);
  });

  it('wipeAndLeave goes to the game, or to the page it is given, after the wipe', async () => {
    const goTo = vi.spyOn(wipe as unknown as { goTo(path: string): void }, 'goTo').mockImplementation(() => undefined);

    await wipe.wipeAndLeave();
    expect(goTo).toHaveBeenLastCalledWith('arcade');
    expect(vault.hasVault()).toBe(false);

    await wipe.wipeAndLeave('login');
    expect(goTo).toHaveBeenLastCalledWith('login');
  });

  it('a stuck step does not stop the key from being destroyed first', async () => {
    const destroy = vi.spyOn(vault, 'destroy');
    vi.spyOn(store, 'deleteDatabase').mockImplementation(() => new Promise<void>(() => undefined)); // never finishes
    await wipe.wipe();
    expect(destroy).toHaveBeenCalled();
    expect(localStorage.getItem(VAULT_HEADER_KEY)).toBeNull();
  }, 15000);
});
