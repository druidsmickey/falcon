import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Bet, BetRequest } from '../models';
import { MeetingDataService } from './meeting-data.service';
import { OfflineStoreService } from './offline-store.service';
import { AuthService } from './auth.service';
import { VAULT_KDF, VaultService } from '../security/vault.service';

const FAST_KDF = { provide: VAULT_KDF, useValue: { N: 1024, r: 8, p: 1 } };

// The outbox in memory (the real one uses IndexedDB)
class FakeOutbox {
  waiting: Bet[] = [];
  async queueBet(payload: unknown): Promise<void> { this.waiting.push(payload as Bet); }
  async getPendingBets(): Promise<Bet[]> { return [...this.waiting]; }
}

function betRequest(over: Partial<BetRequest> = {}): BetRequest {
  return {
    meetingName: 'M1', raceNum: 1, horseNum: 1, horseName: 'ONE', clientName: 'ANN', tax: 5,
    betTime: new Date('2026-10-24T10:00:00Z'), f500: 100, books: 10, stake: 1000, payout: 5000,
    clientRequestId: 'r1', ...over,
  };
}
const savedBet = (over: Partial<Bet> = {}): Bet => ({ ...(betRequest() as Bet), _id: 's1', betTime: '2026-10-24T09:00:00Z', clientRequestId: 'old', ...over });

describe('MeetingDataService: sending bets', () => {
  let service: MeetingDataService;
  let http: HttpTestingController;
  let outbox: FakeOutbox;
  let online: boolean;

  beforeEach(async () => {
    localStorage.clear();
    online = true;
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
    outbox = new FakeOutbox();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), FAST_KDF, { provide: OfflineStoreService, useValue: outbox }, { provide: AuthService, useValue: { hasToken: () => false } }],
    });
    await TestBed.inject(VaultService).create('correct horse');
    service = TestBed.inject(MeetingDataService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('a bet is sent to the server when it can be reached', async () => {
    const result = service.submitBet(betRequest());
    http.expectOne(r => r.method === 'POST' && r.url.endsWith('/bets')).flush({ success: true });
    expect(await result).toEqual({ status: 'saved' });
    expect(outbox.waiting).toHaveLength(0);
  });

  it('with no connection the bet is queued and no request is made', async () => {
    online = false;
    expect(await service.submitBet(betRequest())).toEqual({ status: 'queued' });
    http.expectNone(() => true);
    expect(outbox.waiting).toHaveLength(1);
  });

  it('a bet is queued, not lost, when the server does not answer although the browser says online', async () => {
    const result = service.submitBet(betRequest());
    http.expectOne(r => r.method === 'POST').error(new ProgressEvent('error'));
    expect(await result).toEqual({ status: 'queued' });
    expect(outbox.waiting.map(b => b.clientRequestId)).toEqual(['r1']);
  });

  it('a bet is queued when the server answers with a server fault', async () => {
    const result = service.submitBet(betRequest());
    http.expectOne(r => r.method === 'POST').flush({ error: 'database down' }, { status: 500, statusText: 'Server Error' });
    expect(await result).toEqual({ status: 'queued' });
    expect(outbox.waiting).toHaveLength(1);
  });

  it('a bet the server refuses as invalid is reported and not queued', async () => {
    const result = service.submitBet(betRequest());
    http.expectOne(r => r.method === 'POST').flush({ error: 'payout does not match books x 500' }, { status: 400, statusText: 'Bad Request' });
    expect(await result).toEqual({ status: 'rejected', message: 'payout does not match books x 500' });
    expect(outbox.waiting).toHaveLength(0);
  });

  it('a queued bet is added to the lists straight away', async () => {
    online = false;
    await service.submitBet(betRequest({ clientRequestId: 'r-new' }));
    // served from memory: no request to the server is needed
    expect((await service.getBets()).map(b => b.clientRequestId)).toContain('r-new');
    http.expectNone(() => true);
  });
});

describe('MeetingDataService: bets read after the page was reloaded', () => {
  let service: MeetingDataService;
  let http: HttpTestingController;
  let outbox: FakeOutbox;

  async function create(waiting: Bet[]) {
    localStorage.clear();
    outbox = new FakeOutbox();
    outbox.waiting = waiting;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), FAST_KDF, { provide: OfflineStoreService, useValue: outbox }, { provide: AuthService, useValue: { hasToken: () => true } }],
    });
    await TestBed.inject(VaultService).create('correct horse');
    service = TestBed.inject(MeetingDataService);
    (service as unknown as { _meetingName: string })._meetingName = 'M1'; // as after the races were read
    http = TestBed.inject(HttpTestingController);
  }

  const read = async (answer: (req: ReturnType<HttpTestingController['expectOne']>) => void) => {
    const promise = service.getBets();
    answer(http.expectOne(r => r.method === 'GET' && r.url.includes('/bets?meetingName=')));
    return promise;
  };

  afterEach(() => localStorage.clear());

  it('bets waiting in the outbox are shown even when the server copy is old', async () => {
    await create([betRequest({ clientRequestId: 'queued-1' }) as Bet]);
    const bets = await read(req => req.flush([savedBet()]));
    expect(bets.map(b => b.clientRequestId)).toEqual(['queued-1', 'old']);
  });

  it('bets waiting in the outbox are shown when the server cannot be reached', async () => {
    await create([betRequest({ clientRequestId: 'queued-1' }) as Bet]);
    const bets = await read(req => req.error(new ProgressEvent('error')));
    expect(bets.map(b => b.clientRequestId)).toEqual(['queued-1']);
  });

  it('a bet that is both on the server and in the outbox is listed once', async () => {
    await create([betRequest({ clientRequestId: 'same' }) as Bet]);
    const bets = await read(req => req.flush([savedBet({ clientRequestId: 'same' })]));
    expect(bets.filter(b => b.clientRequestId === 'same')).toHaveLength(1);
  });

  it('bets waiting for another meeting are not shown', async () => {
    await create([betRequest({ meetingName: 'OTHER', clientRequestId: 'elsewhere' }) as Bet]);
    const bets = await read(req => req.flush([savedBet()]));
    expect(bets.map(b => b.clientRequestId)).toEqual(['old']);
  });

  it('waiting bets are listed newest first', async () => {
    await create([
      betRequest({ clientRequestId: 'early', betTime: new Date('2026-10-24T10:00:00Z') }) as Bet,
      betRequest({ clientRequestId: 'late', betTime: new Date('2026-10-24T11:00:00Z') }) as Bet,
    ]);
    const bets = await read(req => req.flush([]));
    expect(bets.map(b => b.clientRequestId)).toEqual(['late', 'early']);
  });

  it('the last bet is the newest one, including those still waiting', async () => {
    await create([betRequest({ clientRequestId: 'queued-late', betTime: new Date('2026-10-24T12:00:00Z') }) as Bet]);
    const last = service.getLastBet();
    http.expectOne(r => r.url.endsWith('/bets/last')).flush(savedBet());
    expect((await last)?.clientRequestId).toBe('queued-late');
  });

  it('the last bet is the saved one when nothing is waiting', async () => {
    await create([]);
    const last = service.getLastBet();
    http.expectOne(r => r.url.endsWith('/bets/last')).flush(savedBet());
    expect((await last)?.clientRequestId).toBe('old');
  });
});
