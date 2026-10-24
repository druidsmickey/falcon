import { describe, expect, it } from 'vitest';
import {
  createHeader, fromBase64, isVaultName, newDataKey, openHeader, openValue, sealValue, seal, open,
  storageName, toBase64, deriveKey, VaultHeader,
} from './vault-crypto';

// a cheap setting: the real one is slow on purpose
const FAST = { N: 1024, r: 8, p: 1 };

describe('vault crypto: values', () => {
  const dek = newDataKey();

  it('a value comes back unchanged', () => {
    const value = { name: 'ANN', bets: [1, 2, 3], note: 'Zoë ✓' };
    expect(openValue(dek, 'bets', sealValue(dek, 'bets', value))).toEqual(value);
  });

  it('the stored text does not contain the data', () => {
    const sealed = sealValue(dek, 'bets', { clientName: 'SECRET CLIENT', meeting: 'ASCOT 2026' });
    expect(sealed).not.toContain('SECRET');
    expect(sealed).not.toContain('ASCOT');
    expect(atob(sealed.slice(2))).not.toContain('SECRET');
  });

  it('the same value is sealed differently every time', () => {
    expect(sealValue(dek, 'x', 'same')).not.toBe(sealValue(dek, 'x', 'same'));
  });

  it('a different key cannot open it', () => {
    expect(openValue(newDataKey(), 'bets', sealValue(dek, 'bets', 'secret'))).toBeNull();
  });

  it('a value moved to another name is refused', () => {
    expect(openValue(dek, 'params', sealValue(dek, 'bets', 'secret'))).toBeNull();
  });

  it('a changed value is refused', () => {
    const sealed = sealValue(dek, 'bets', 'secret');
    const bytes = fromBase64(sealed.slice(2));
    bytes[bytes.length - 1] ^= 1;
    expect(openValue(dek, 'bets', '1.' + toBase64(bytes))).toBeNull();
  });

  it('rubbish is refused without an error', () => {
    for (const bad of ['', 'x', '1.', '1.AAAA', '2.AAAA', '1.!!!!', null as unknown as string, 42 as unknown as string]) {
      expect(openValue(dek, 'bets', bad)).toBeNull();
    }
  });

  it('storage names are the same for the same key and name, and hide the name', () => {
    expect(storageName(dek, 'bets:ASCOT')).toBe(storageName(dek, 'bets:ASCOT'));
    expect(storageName(dek, 'bets:ASCOT')).not.toContain('ASCOT');
    expect(storageName(dek, 'bets:ASCOT')).not.toBe(storageName(dek, 'bets:KEMPTON'));
    expect(storageName(newDataKey(), 'bets:ASCOT')).not.toBe(storageName(dek, 'bets:ASCOT'));
    expect(isVaultName(storageName(dek, 'x'))).toBe(true);
    expect(isVaultName('token')).toBe(false);
  });

  it('seal and open work on raw bytes with the extra data checked', () => {
    const key = newDataKey();
    const sealed = seal(key, 'context-a', new Uint8Array([1, 2, 3]));
    expect(Array.from(open(key, 'context-a', sealed) ?? [])).toEqual([1, 2, 3]);
    expect(open(key, 'context-b', sealed)).toBeNull();
  });
});

describe('vault crypto: the password', () => {
  it('the right password opens the data key, a wrong one does not', async () => {
    const dek = newDataKey();
    const header = await createHeader('correct horse battery staple', dek, FAST);
    expect(Array.from((await openHeader(header, 'correct horse battery staple')) ?? [])).toEqual(Array.from(dek));
    expect(await openHeader(header, 'correct horse battery stapl')).toBeNull();
    expect(await openHeader(header, '')).toBeNull();
  });

  it('the header does not contain the data key or the password', async () => {
    const dek = newDataKey();
    const header = await createHeader('hunter2 hunter2', dek, FAST);
    const text = JSON.stringify(header);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain(toBase64(dek));
  });

  it('two headers for the same password differ', async () => {
    const dek = newDataKey();
    const a = await createHeader('pw-pw-pw', dek, FAST);
    const b = await createHeader('pw-pw-pw', dek, FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.wrapped).not.toBe(b.wrapped);
  });

  it('changing the stretching settings in the header is detected', async () => {
    const header = await createHeader('pw-pw-pw', newDataKey(), FAST);
    expect(await openHeader({ ...header, N: 2048 } as VaultHeader, 'pw-pw-pw')).toBeNull();
    expect(await openHeader({ ...header, r: 4 } as VaultHeader, 'pw-pw-pw')).toBeNull();
  });

  it('a changed or unknown header is refused', async () => {
    const header = await createHeader('pw-pw-pw', newDataKey(), FAST);
    expect(await openHeader({ ...header, wrapped: header.wrapped.slice(0, -4) + 'AAAA' }, 'pw-pw-pw')).toBeNull();
    expect(await openHeader({ ...header, v: 2 } as unknown as VaultHeader, 'pw-pw-pw')).toBeNull();
    expect(await openHeader({ ...header, salt: '%%%' }, 'pw-pw-pw')).toBeNull();
  });

  it('the same password typed in another Unicode form gives the same key', async () => {
    const salt = new Uint8Array(16);
    const composed = await deriveKey('café-pass', salt, FAST);
    const decomposed = await deriveKey('café-pass', salt, FAST);
    expect(toBase64(composed)).toBe(toBase64(decomposed));
  });

  it('the default setting is the slow one', async () => {
    const t = Date.now();
    await deriveKey('pw', new Uint8Array(16));
    expect(Date.now() - t).toBeGreaterThan(30); // far slower than the FAST setting, which makes guessing expensive
  });
});
