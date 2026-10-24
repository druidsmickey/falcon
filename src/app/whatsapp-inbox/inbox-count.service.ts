import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../services/auth.service';

/** How often the number is asked for while the inbox is not open. */
const POLL_SECONDS = 20;

/**
 * How many bets read from WhatsApp wait for approval, for the counter on the Inbox tab. The server keeps
 * them whether or not the tab is open; this only asks how many there are. The inbox itself sets the number
 * whenever it loads its list, so it is exact while it is open.
 */
@Injectable({ providedIn: 'root' })
export class InboxCountService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly count = signal(0);

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_SECONDS * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  set(count: number): void {
    this.count.set(count);
  }

  private async poll(): Promise<void> {
    // without a login token (locked, or working from the saved data) the server cannot be asked
    if (!this.auth.hasToken()) return;
    try {
      const result = await firstValueFrom(this.http.get<{ count: number }>(`${environment.apiUrl}/api/whatsapp-inbox/count`));
      if (typeof result.count === 'number') this.count.set(result.count);
    } catch {
      // keep the number as it was
    }
  }
}
