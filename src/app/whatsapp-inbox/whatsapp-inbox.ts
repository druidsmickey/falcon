import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { HorseParam, SelectedRace } from '../models';
import { MeetingDataService } from '../services/meeting-data.service';
import { InboxCountService } from './inbox-count.service';
import { Draft, InboxItem, Surroundings, chooseKind, draftFrom, hasProblem, problems, savedFigures, toBetRequest } from './inbox-bet';

interface OddsList {
  raceNum: number;
  runners: number;
  sentAt: string;
  odds: { horseNum: number; odds: number }[];
}

interface HorseButton {
  horseNum: number;
  horseName: string;
  disabled: boolean;
  winner: boolean;
}

/** A bet that was saved from the inbox, shown the way the Entry page shows its last bet. */
interface SavedBet {
  id: string;
  clientName: string;
  raceNum: number;
  horseNum: number;
  horseName: string;
  f500?: number;
  odds100?: number;
  books: number;
  stake: number;
  /** Kept to send later: the server could not be reached. */
  queued: boolean;
  demo: boolean;
}

type NumberField = 'tax';

/** How many saved bets stay on screen. */
const SAVED_SHOWN = 8;

/**
 * The bets read from WhatsApp messages. Each one waits here as a filled-in Entry betslip, with the message it
 * came from above it, until a person has checked it and pressed Save Bet (or Dismiss). Saving sends it through
 * the normal bet entry, so it is checked and saved like any other bet, offline queue included, and the card is
 * replaced by the saved bet.
 */
@Component({
  selector: 'app-whatsapp-inbox',
  imports: [DatePipe, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatRadioModule],
  templateUrl: './whatsapp-inbox.html',
  styleUrl: './whatsapp-inbox.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhatsappInbox implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private meetingData = inject(MeetingDataService);
  private counter = inject(InboxCountService);
  private api = `${environment.apiUrl}/api/whatsapp-inbox`;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Bets already saved here whose confirmation the server has not heard yet; they are not shown again meanwhile. */
  private unconfirmed = new Map<string, { saved: object }>();

  protected readonly drafts = signal<Draft[]>([]);
  protected readonly saved = signal<SavedBet[]>([]);
  protected readonly odds = signal<OddsList | null>(null);
  protected readonly races = signal<SelectedRace[]>([]);
  protected readonly params = signal<HorseParam[]>([]);
  protected readonly error = signal('');
  protected readonly busy = signal<ReadonlySet<string>>(new Set());
  protected readonly loaded = signal(false);
  protected readonly itemErrors = signal<Record<string, string>>({});
  /** On a phone one bet is shown at a time, with buttons to move between them. */
  protected readonly compact = signal(false);
  private readonly position = signal(0);
  protected readonly current = computed(() => Math.min(this.position(), Math.max(0, this.drafts().length - 1)));
  protected readonly shownDrafts = computed(() => (this.compact() ? this.drafts().slice(this.current(), this.current() + 1) : this.drafts()));

  async ngOnInit(): Promise<void> {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const phone = window.matchMedia('(max-width: 600px)');
      this.compact.set(phone.matches);
      phone.addEventListener('change', event => this.compact.set(event.matches));
    }
    await Promise.all([this.refresh(), this.loadMeeting()]);
    this.timer = setInterval(() => void this.refresh(), 5000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- loading

  protected async refresh(): Promise<void> {
    try {
      await this.confirmPending();
      const result = await firstValueFrom(this.http.get<{ items: InboxItem[]; odds: OddsList | null }>(this.api));
      this.odds.set(result.odds);
      // what was typed into the bets already on screen is kept; new ones are added, decided ones disappear
      const existing = new Map(this.drafts().map(d => [d.id, d]));
      this.drafts.set(result.items.filter(item => !this.unconfirmed.has(item.id)).map(item => existing.get(item.id) ?? draftFrom(item)));
      this.counter.set(this.drafts().length);
      this.error.set('');
    } catch {
      this.error.set('The server cannot be reached. Messages are kept there and will show here again.');
    }
    this.loaded.set(true);
  }

  /** Tells the server about bets that were saved while it could not be reached. */
  private async confirmPending(): Promise<void> {
    for (const [id, body] of [...this.unconfirmed]) {
      try {
        await firstValueFrom(this.http.post(`${this.api}/${id}/confirm`, body));
        this.unconfirmed.delete(id);
      } catch {
        return;
      }
    }
  }

  private async loadMeeting(): Promise<void> {
    try {
      this.races.set((await this.meetingData.getSelectedRaces()).slice().sort((a, b) => a.raceNum - b.raceNum));
      this.params.set(await this.meetingData.getParams());
    } catch {
      this.races.set([]);
      this.params.set([]);
    }
  }

  // ---------------------------------------------------------------- editing a bet

  private change(id: string, edit: (draft: Draft) => Draft): void {
    this.drafts.update(list => list.map(d => (d.id === id ? edit(d) : d)));
  }

  protected setNumber(draft: Draft, field: NumberField, event: Event): void {
    const value = this.numberFrom(event);
    this.change(draft.id, d => ({ ...d, [field]: value }));
  }

  /** The first figure of the Entry row: books or stakes (the number as sent while it is not said which). */
  protected amountOf(draft: Draft): number | null {
    return draft.kind === 'books' ? draft.books : draft.kind === 'stake' ? draft.stake : draft.amount;
  }

  /** The second figure: the F500 for books, the odds for a stake. */
  protected rateOf(draft: Draft): number | null {
    return draft.kind === 'books' ? draft.f500 : draft.kind === 'stake' ? draft.odds100 : draft.rate;
  }

  private numberFrom(event: Event): number | null {
    const text = (event.target as HTMLInputElement).value.trim().replace(/,/g, '');
    const value = text === '' ? null : Number(text);
    return value === null || Number.isNaN(value) ? null : value;
  }

  protected setAmount(draft: Draft, event: Event): void {
    const value = this.numberFrom(event);
    this.change(draft.id, d => (d.kind === 'books' ? { ...d, books: value } : d.kind === 'stake' ? { ...d, stake: value } : { ...d, amount: value }));
  }

  protected setRate(draft: Draft, event: Event): void {
    const value = this.numberFrom(event);
    this.change(draft.id, d => (d.kind === 'books' ? { ...d, f500: value } : d.kind === 'stake' ? { ...d, odds100: value } : { ...d, rate: value }));
  }

  protected setClient(draft: Draft, event: Event): void {
    const value = (event.target as HTMLInputElement).value.toUpperCase();
    this.change(draft.id, d => ({ ...d, clientName: value }));
  }

  protected selectRace(draft: Draft, raceNum: number): void {
    // as on the Entry page, a new race starts without a horse
    this.change(draft.id, d => (d.raceNum === raceNum ? d : { ...d, raceNum, horseNum: null }));
  }

  protected selectHorse(draft: Draft, horseNum: number): void {
    this.change(draft.id, d => ({ ...d, horseNum }));
  }

  protected setPurchase(draft: Draft, purchase: boolean): void {
    this.change(draft.id, d => ({ ...d, purchase }));
  }

  /** The F500 / Odds choice of the Entry page: F500 is books at an F500, Odds is a stake at odds. */
  protected setKind(draft: Draft, kind: 'books' | 'stake'): void {
    this.change(draft.id, d => chooseKind(d, kind));
  }

  protected useListOdds(draft: Draft): void {
    const odds = this.listOdds(draft);
    if (odds !== null) this.change(draft.id, d => ({ ...d, odds100: odds }));
  }

  // ---------------------------------------------------------------- what the screen shows

  /** The odds of this horse in the latest odds list, if it is for the same race. */
  protected listOdds(draft: Draft): number | null {
    const list = this.odds();
    if (!list || list.raceNum !== draft.raceNum) return null;
    return list.odds.find(o => o.horseNum === draft.horseNum)?.odds ?? null;
  }

  /** The horse buttons of the draft's race, as the Entry page shows them. */
  protected horsesOf(draft: Draft): HorseButton[] {
    const inRace = this.params().filter(p => p.raceNum === draft.raceNum);
    const hasWinner = inRace.some(p => p.winner);
    return inRace
      .slice()
      .sort((a, b) => a.horseNum - b.horseNum)
      .map(p => ({
        horseNum: p.horseNum,
        horseName: p.horseName || `Horse ${p.horseNum}`,
        disabled: !!p.special || !!p.rule4 || hasWinner,
        winner: !!p.winner,
      }));
  }

  protected horseName(draft: Draft): string {
    return this.horsesOf(draft).find(h => h.horseNum === draft.horseNum)?.horseName ?? '';
  }

  private around(draft: Draft): Surroundings {
    const races = this.races();
    const params = this.params();
    const horse = this.horsesOf(draft).find(h => h.horseNum === draft.horseNum);
    return {
      raceExists: races.length === 0 ? null : races.some(r => r.raceNum === draft.raceNum),
      horseExists: params.length === 0 ? null : !!horse,
      blocked: !!horse && horse.disabled,
    };
  }

  protected missing(draft: Draft): string[] {
    return problems(draft, this.around(draft));
  }

  protected has(draft: Draft, field: string): boolean {
    return hasProblem(this.missing(draft), field);
  }

  protected isBusy(draft: Draft): boolean {
    return this.busy().has(draft.id);
  }

  protected shown(value: number | null): string {
    return value === null ? '' : String(value);
  }

  protected kindOf(draft: Draft): string {
    return draft.kind === 'books' ? 'f500' : draft.kind === 'stake' ? 'odds' : '';
  }

  // ---------------------------------------------------------------- deciding

  private setBusy(id: string, on: boolean): void {
    this.busy.update(set => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private setItemError(id: string, message: string): void {
    this.itemErrors.update(map => ({ ...map, [id]: message }));
  }

  /** Saves the bet like the Entry page does. The card is replaced by the saved bet as soon as it is saved or queued. */
  protected async save(draft: Draft): Promise<void> {
    if (this.missing(draft).length > 0 || this.isBusy(draft)) return;
    const name = this.horseName(draft) || `Horse ${draft.horseNum}`;
    const bet = toBetRequest(draft, this.meetingData.getMeetingName(), name, this.around(draft));
    if (!bet) return;

    this.setBusy(draft.id, true);
    this.setItemError(draft.id, '');
    try {
      // a demo bet goes through the same checks on screen, but nothing is sent
      const result = draft.demo ? { status: 'saved' as const } : await this.meetingData.submitBet(bet);
      if (result.status === 'rejected') {
        this.setItemError(draft.id, `The server refused this bet: ${result.message}`);
        return;
      }

      this.drafts.update(list => list.filter(d => d.id !== draft.id));
      this.counter.set(this.drafts().length);
      this.saved.update(list => [
        {
          id: draft.id,
          clientName: bet.clientName,
          raceNum: bet.raceNum,
          horseNum: bet.horseNum,
          horseName: bet.horseName,
          f500: bet.f500,
          odds100: bet.odds100,
          books: bet.books ?? 0,
          stake: bet.stake ?? 0,
          queued: result.status === 'queued',
          demo: draft.demo,
        },
        ...list,
      ].slice(0, SAVED_SHOWN));

      // tell the server it is no longer waiting; if that fails it is tried again later, and the bet cannot be entered
      // twice anyway (same request id)
      this.unconfirmed.set(draft.id, { saved: savedFigures(draft) });
      await this.confirmPending();
    } finally {
      this.setBusy(draft.id, false);
    }
  }

  protected move(step: number): void {
    this.position.set(Math.max(0, Math.min(this.drafts().length - 1, this.current() + step)));
  }

  protected async loadDemo(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${this.api}/demo`, {}));
      await this.refresh();
    } catch {
      this.error.set('The demo could not be loaded.');
    }
  }

  protected async dismiss(draft: Draft): Promise<void> {
    if (this.isBusy(draft)) return;
    this.setBusy(draft.id, true);
    try {
      await firstValueFrom(this.http.post(`${this.api}/${draft.id}/dismiss`, {}));
      this.drafts.update(list => list.filter(d => d.id !== draft.id));
      this.counter.set(this.drafts().length);
    } catch {
      this.setItemError(draft.id, 'Could not dismiss this. Check the connection.');
    } finally {
      this.setBusy(draft.id, false);
    }
  }
}
