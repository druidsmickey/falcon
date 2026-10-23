import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class RecentClientsService {
  private apiUrl = `${environment.apiUrl}/api`;
  private recentClientsSubject = new BehaviorSubject<string[]>([]);
  public recentClients$ = this.recentClientsSubject.asObservable();

  constructor(private http: HttpClient) {}

  loadRecentClients(): Promise<string[]> {
    return new Promise((resolve) => {
      this.http.get<string[]>(`${this.apiUrl}/bets/recent-clients`).subscribe({
        next: (clients) => {
          this.recentClientsSubject.next(clients);
          resolve(clients);
        },
        error: (error) => {
          console.error('Error loading recent clients:', error);
          resolve([]);
        }
      });
    });
  }

  getRecentClients(): string[] {
    return this.recentClientsSubject.value;
  }
  
  getRecentClients$(): Observable<string[]> {
    return this.recentClients$;
  }
}
