import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import * as QRCode from 'qrcode';
import { environment } from '../../environments/environment';

interface WhatsAppStatus {
  status: string;
  isReady: boolean;
  qrCode: string | null;
}

/** What the WhatsApp routes answer (not every route sends every field). */
interface WhatsAppResponse {
  success?: boolean;
  message?: string;
  error?: string;
  browserVersion?: string;
  chromePath?: string;
  suggestion?: string;
}

interface ListenContact {
  id: string;
  name: string;
  number: string;
  nickname: string;
  listen: boolean;
}

/** What the server did with a message it received (to explain why a bet did not reach the inbox). */
interface ActivityItem {
  at: string;
  from: string;
  name: string | null;
  text: string | null;
  result: string;
}

/** One thing WhatsApp announced and the last thing the server did with it. */
interface TraceItem {
  at: string;
  type: string;
  from: string | null;
  author: string | null;
  fromMe: boolean;
  isStatus: boolean;
  hasBody: boolean;
  hasId: boolean;
  branch: string;
}

/** How many times WhatsApp announced something to the server (the ignored ones included), and the fallback checks. */
interface Counters {
  events: number;
  fromOthers?: number;
  errors?: number;
  lastError?: string | null;
  lastEventAt: string | null;
  ignored: { fromMe: number; status: number; broadcast: number };
  results?: { added: number; notSaved: number; notListened: number; nothingToRead: number; noText: number };
  polled: number;
  lastPollAt: string | null;
}

/**
 * The WhatsApp tab: the connection to WhatsApp, one button that copies the contacts of the phone, and for each
 * contact the nickname bets are entered under and whether its messages are read (they then arrive in the Inbox).
 */
@Component({
  selector: 'app-whatsapp',
  imports: [DatePipe, MatButtonModule, MatCardModule, MatProgressSpinnerModule],
  templateUrl: './whatsapp.html',
  styleUrl: './whatsapp.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Whatsapp implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  protected readonly status = signal<WhatsAppStatus>({ status: 'disconnected', isReady: false, qrCode: null });
  protected readonly qrImage = signal('');
  protected readonly loading = signal(false);
  protected readonly syncing = signal(false);
  protected readonly statusMessage = signal('');
  protected readonly contacts = signal<ListenContact[]>([]);
  protected readonly search = signal('');
  protected readonly onlyListened = signal(false);
  protected readonly error = signal('');
  protected readonly activity = signal<ActivityItem[]>([]);
  protected readonly counters = signal<Counters | null>(null);
  protected readonly trace = signal<TraceItem[]>([]);

  protected readonly listened = computed(() => this.contacts().filter(c => c.listen).length);
  protected readonly shown = computed(() => {
    const text = this.search().trim().toLowerCase();
    return this.contacts().filter(c =>
      (!this.onlyListened() || c.listen) &&
      (text === '' || c.name.toLowerCase().includes(text) || c.nickname.toLowerCase().includes(text) || c.number.includes(text))
    );
  });

  private lastQrText: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    void this.checkStatus();
    void this.loadContacts();
    void this.loadActivity();
    // while not connected the status (and the QR code) is checked every 3 seconds
    this.timer = setInterval(() => {
      if (this.status().status !== 'ready') void this.checkStatus();
      void this.loadActivity();
    }, 3000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- the connection

  protected async checkStatus(): Promise<void> {
    try {
      const status = await firstValueFrom(this.http.get<WhatsAppStatus>(`${this.api}/api/whatsapp/status`));
      this.status.set(status);
      this.updateQrImage(status.qrCode);
    } catch {
      // the next check tries again
    }
  }

  private async call(message: string, request: () => Promise<WhatsAppResponse>, after?: () => void): Promise<void> {
    this.loading.set(true);
    this.statusMessage.set(message);
    try {
      const response = await request();
      this.statusMessage.set(response.message ?? '');
      after?.();
    } catch (error) {
      const failure = error as { error?: { error?: string }; message?: string };
      this.statusMessage.set('Error: ' + (failure.error?.error || failure.message));
    } finally {
      this.loading.set(false);
    }
  }

  protected initializeWhatsApp(): Promise<void> {
    return this.call('Initializing WhatsApp client...', () => firstValueFrom(this.http.post<WhatsAppResponse>(`${this.api}/api/whatsapp/initialize`, {})), () => void this.checkStatus());
  }

  protected disconnectWhatsApp(): Promise<void> {
    return this.call('Disconnecting...', () => firstValueFrom(this.http.post<WhatsAppResponse>(`${this.api}/api/whatsapp/disconnect`, {})), () => void this.checkStatus());
  }

  protected resetWhatsApp(): Promise<void> {
    if (!confirm('This will clear your WhatsApp session and generate a new QR code. You will need to scan it again. Continue?')) {
      return Promise.resolve();
    }
    return this.call('Resetting WhatsApp session...', () => firstValueFrom(this.http.post<WhatsAppResponse>(`${this.api}/api/whatsapp/reset`, {})), () => setTimeout(() => void this.checkStatus(), 2000));
  }

  protected async testPuppeteer(): Promise<void> {
    this.loading.set(true);
    this.statusMessage.set('Testing if Chrome can launch on server...');
    try {
      const response = await firstValueFrom(this.http.get<WhatsAppResponse>(`${this.api}/api/whatsapp/test-puppeteer`));
      this.statusMessage.set(response.success
        ? `Server test passed. Browser: ${response.browserVersion}. Chrome path: ${response.chromePath}`
        : `Server test failed: ${response.error}`);
    } catch (error) {
      const failure = error as { error?: { error?: string; suggestion?: string }; message?: string };
      const text = failure.error?.error || failure.message || '';
      this.statusMessage.set(/Could not find Chrome|spawn|ENOENT/.test(text)
        ? 'Chrome is not installed on the server. Install it with: sudo apt-get install -y chromium-browser'
        : `Test failed: ${text}. ${failure.error?.suggestion ?? ''}`);
    } finally {
      this.loading.set(false);
    }
  }

  protected statusColor(): string {
    switch (this.status().status) {
      case 'ready': return 'green';
      case 'qr_code': return 'orange';
      case 'authenticated': return 'lightgreen';
      case 'disconnected': return 'red';
      default: return 'gray';
    }
  }

  protected statusText(): string {
    const status = this.status().status;
    switch (status) {
      case 'ready': return 'Connected';
      case 'qr_code': return 'Scan QR Code';
      case 'authenticated': return 'Authenticating...';
      case 'disconnected': return 'Disconnected';
      case 'auth_failure': return 'Authentication Failed';
      default: return status;
    }
  }

  private updateQrImage(qrText: string | null): void {
    if (qrText === this.lastQrText) return;
    this.lastQrText = qrText;
    if (!qrText) {
      this.qrImage.set('');
      return;
    }
    QRCode.toDataURL(qrText, { width: 300, margin: 1 })
      .then(image => {
        // ignore the result if a newer code arrived while this one was being drawn
        if (this.lastQrText === qrText) this.qrImage.set(image);
      })
      .catch(error => console.error('Error drawing the QR code:', error));
  }

  // ---------------------------------------------------------------- what was received

  protected async loadActivity(): Promise<void> {
    try {
      const result = await firstValueFrom(this.http.get<{ messages: ActivityItem[]; counters?: Counters; trace?: TraceItem[] }>(`${this.api}/api/whatsapp-inbox/activity`));
      this.activity.set(result.messages.slice(0, 15));
      this.counters.set(result.counters ?? null);
      this.trace.set((result.trace ?? []).slice(0, 12));
    } catch {
      // the next check tries again
    }
  }

  // ---------------------------------------------------------------- the contacts

  private async loadContacts(): Promise<void> {
    try {
      const result = await firstValueFrom(this.http.get<{ contacts: ListenContact[] }>(`${this.api}/api/whatsapp-inbox/contacts`));
      this.contacts.set(result.contacts);
    } catch {
      this.error.set('The contacts could not be loaded.');
    }
  }

  /** Copies the contacts of the phone. Contacts already saved keep their nickname and listen choice. */
  protected async syncContacts(): Promise<void> {
    if (!this.status().isReady) {
      this.statusMessage.set('WhatsApp is not connected. Connect it first.');
      return;
    }
    this.syncing.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(this.http.post<{ total: number; added: number; renamed: number }>(`${this.api}/api/whatsapp/sync-contacts`, {}));
      this.statusMessage.set(`${result.total} contacts on the phone: ${result.added} new, ${result.renamed} renamed.`);
      await this.loadContacts();
    } catch (error) {
      const failure = error as { error?: { error?: string }; message?: string };
      this.error.set('The contacts could not be synced: ' + (failure.error?.error || failure.message));
    } finally {
      this.syncing.set(false);
    }
  }

  protected async setListen(contact: ListenContact, listen: boolean): Promise<void> {
    await this.save(contact, { listen });
  }

  protected async setNickname(contact: ListenContact, event: Event): Promise<void> {
    const nickname = (event.target as HTMLInputElement).value.trim();
    if (nickname !== contact.nickname) await this.save(contact, { nickname });
  }

  protected setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  private async save(contact: ListenContact, changes: Partial<Pick<ListenContact, 'listen' | 'nickname'>>): Promise<void> {
    try {
      await firstValueFrom(this.http.patch(`${this.api}/api/whatsapp-inbox/contacts/${contact.id}`, changes));
      this.contacts.update(list => list.map(c => (c.id === contact.id ? { ...c, ...changes } : c)));
      this.error.set('');
    } catch {
      this.error.set('That change could not be saved.');
    }
  }
}
