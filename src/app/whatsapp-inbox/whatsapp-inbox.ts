import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { HorseParam } from '../models';
import { MeetingDataService } from '../services/meeting-data.service';
import { Draft, InboxItem, chooseKind, draftFrom, problems, toBetRequest } from './inbox-bet';

interface OddsList {
  raceNum: number;
  runners: number;
  sentAt: string;
  odds: { horseNum: number; odds: number }[];
}

interface ListenContact {
  id: string;
  name: string;
  number: string;
  nickname: string;
  listen: boolean;
}

type NumberField = 'raceNum' | 'horseNum' | 'books' | 'f500' | 'stake' | 'odds100' | 'tax';

/**
 * The bets read from WhatsApp messages. Each one waits here with the original message beside it, until a
 * person has filled in what is missing and confirmed it (or dismissed it). Confirming sends it through the
 * normal bet entry, so it is checked and saved like any other bet, offline queue included.
 */
@Component({
  selector: 'app-whatsapp-inbox',
  imports: [DatePipe],
  templateUrl: './whatsapp-inbox.html',
  styleUrl: './whatsapp-inbox.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhatsappInbox implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private meetingData = inject(MeetingDataService);
  private api = `${environment.apiUrl}/api/whatsapp-inbox`;
  private timer: ReturnType<typeof setInterval> | null = null;

  protected readonly drafts = signal<Draft[]>([]);
  protected readonly odds = signal<OddsList | null>(null);
  protected readonly contacts = signal<ListenContact[]>([]);
  protected readonly params = signal<HorseParam[]>([]);
  protected readonly error = signal('');
  protected readonly busy = signal<ReadonlySet<string>>(new Set());
  protected readonly loaded = signal(false);
  protected readonly listened = computed(() => this.contacts().filter(c => c.listen).length);
  protected readonly itemErrors = signal<Record<string, string>>({});

  async ngOnInit(): Promise<void> {
    await Promise.all([this.refresh(), this.loadContacts(), this.loadParams()]);
    this.timer = setInterval(() => void this.refresh(), 10000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- loading

  protected async refresh(): Promise<void> {
    try {
      const result = await firstValueFrom(this.http.get<{ items: InboxItem[]; odds: OddsList | null }>(this.api));
      this.odds.set(result.odds);
      // what was typed into the bets already on screen is kept; new ones are added, decided ones disappear
      const existing = new Map(this.drafts().map(d => [d.id, d]));
      this.drafts.set(result.items.map(item => existing.get(item.id) ?? draftFrom(item)));
      this.error.set('');
    } catch {
      this.error.set('The server cannot be reached. Messages are kept there and will show here again.');
    }
    this.loaded.set(true);
  }

  private async loadContacts(): Promise<void> {
    try {
      const result = await firstValueFrom(this.http.get<{ contacts: ListenContact[] }>(`${this.api}/contacts`));
      this.contacts.set(result.contacts);
    } catch {
      // shown when the inbox itself cannot be loaded
    }
  }

  private async loadParams(): Promise<void> {
    try {
      await this.meetingData.getSelectedRaces();
      this.params.set(await this.meetingData.getParams());
    } catch {
      this.params.set([]);
    }
  }

  // ---------------------------------------------------------------- who is listened to

  protected async setListen(contact: ListenContact, listen: boolean): Promise<void> {
    await this.saveContact(contact, { listen });
  }

  protected async setNickname(contact: ListenContact, event: Event): Promise<void> {
    const nickname = (event.target as HTMLInputElement).value.trim();
    if (nickname === contact.nickname) return;
    await this.saveContact(contact, { nickname });
    await this.refresh();
  }

  private async saveContact(contact: ListenContact, changes: Partial<Pick<ListenContact, 'listen' | 'nickname'>>): Promise<void> {
    try {
      await firstValueFrom(this.http.patch(`${this.api}/contacts/${contact.id}`, changes));
      this.contacts.update(list => list.map(c => (c.id === contact.id ? { ...c, ...changes } : c)));
    } catch {
      this.error.set('That change could not be saved.');
    }
  }

  // ---------------------------------------------------------------- editing a bet

  private change(id: string, edit: (draft: Draft) => Draft): void {
    this.drafts.update(list => list.map(d => (d.id === id ? edit(d) : d)));
  }

  protected setNumber(draft: Draft, field: NumberField, event: Event): void {
    const text = (event.target as HTMLInputElement).value.trim().replace(/,/g, '');
    const value = text === '' ? null : Number(text);
    this.change(draft.id, d => ({ ...d, [field]: value === null || Number.isNaN(value) ? null : value }));
  }

  protected setClient(draft: Draft, event: Event): void {
    const value = (event.target as HTMLInputElement).value.toUpperCase();
    this.change(draft.id, d => ({ ...d, clientName: value }));
  }

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

  protected horseName(draft: Draft): string {
    const horse = this.params().find(p => p.raceNum === draft.raceNum && p.horseNum === draft.horseNum);
    return horse ? horse.horseName || `Horse ${horse.horseNum}` : '';
  }

  /** null while the horses of the meeting are not known (nothing can be said about it). */
  private horseExists(draft: Draft): boolean | null {
    const params = this.params();
    if (params.length === 0) return null;
    return params.some(p => p.raceNum === draft.raceNum && p.horseNum === draft.horseNum);
  }

  protected missing(draft: Draft): string[] {
    return problems(draft, this.horseExists(draft));
  }

  protected has(draft: Draft, what: string): boolean {
    return this.missing(draft).includes(what);
  }

  protected isBusy(draft: Draft): boolean {
    return this.busy().has(draft.id);
  }

  protected shown(value: number | null): string {
    return value === null ? '' : String(value);
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

  protected async confirm(draft: Draft): Promise<void> {
    if (this.missing(draft).length > 0 || this.isBusy(draft)) return;
    const bet = toBetRequest(draft, this.meetingData.getMeetingName(), this.horseName(draft) || `Horse ${draft.horseNum}`);
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
      // saved, or queued to be sent when the server can be reached; either way it is no longer waiting here
      await firstValueFrom(this.http.post(`${this.api}/${draft.id}/confirm`, {}));
      this.drafts.update(list => list.filter(d => d.id !== draft.id));
    } catch {
      this.setItemError(draft.id, 'The bet was sent, but this list could not be updated. Press Refresh; it will not be entered twice.');
    } finally {
      this.setBusy(draft.id, false);
    }
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
    } catch {
      this.setItemError(draft.id, 'Could not dismiss this. Check the connection.');
    } finally {
      this.setBusy(draft.id, false);
    }
  }
}
