import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { environment } from '../../environments/environment';
import { MeetingDataService } from '../services/meeting-data.service';

@Component({
  selector: 'app-listdata',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './list.html',
  styleUrl: './list.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})

export class ListdataComponent implements OnInit {
  private apiUrl = `${environment.apiUrl}/api`;
  
  items: any[] = [];
  searchRaceNum: number | null = null;
  searchHorseNum: number | null = null;
  searchClientName: string = '';
  meetingName: string = '';
  
  // Cache all params data for horse names
  private allParams: any[] = [];

  get filteredItems() {
    // If no filters, return all
    if (!this.searchRaceNum && !this.searchHorseNum && !this.searchClientName?.trim()) return this.items;

    return this.items.filter(i => {
      // Name filter (case-insensitive, partial match)
      const nameMatch = !this.searchClientName?.trim() ||
        (i.clientName && i.clientName.toLowerCase().includes(this.searchClientName.trim().toLowerCase()));

      // Race and Horse filters
      let raceMatch = true, horseMatch = true;
      if (this.searchRaceNum) {
        raceMatch = Number(i.raceNum) === Number(this.searchRaceNum);
      }
      if (this.searchHorseNum) {
        horseMatch = Number(i.horseNum) === Number(this.searchHorseNum);
      }

      return nameMatch && raceMatch && horseMatch;
    });
  }

  private meetingData = inject(MeetingDataService);

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    try {
      const selectedRaces = await this.meetingData.getSelectedRaces();
      
      if (!selectedRaces || selectedRaces.length === 0) {
        alert('No selected races found. Please select a meeting in the Init page first.');
        return;
      }
      
      this.meetingName = this.meetingData.getMeetingName();
      
      // Load params and bets from shared cache
      const [params, bets] = await Promise.all([
        this.meetingData.getParams(),
        this.meetingData.getBets()
      ]);
      
      this.allParams = params;
      this.items = bets.sort((a: any, b: any) => {
        const dateA = new Date(a.betTime || a.createdAt).getTime();
        const dateB = new Date(b.betTime || b.createdAt).getTime();
        return dateB - dateA;
      });
      
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  cancelBet(item: any) {
    const newCancelledValue = !item.cancelled;
    const action = newCancelledValue ? 'cancel' : 'reactivate';
    
    if (!confirm(`Are you sure you want to ${action} this bet?`)) {
      return;
    }

    this.http.patch(`${this.apiUrl}/bets/${item._id}/cancel`, { cancelled: newCancelledValue }).subscribe({
      next: () => {
        this.meetingData.invalidateBets();
        item.cancelled = newCancelledValue; // Update local state
        this.cdr.detectChanges();
      },
      error: (error: any) => {
        console.error(`Failed to ${action} bet:`, error);
        alert(`Error ${action}ing bet`);
      }
    });
  }

  getHorseName(raceNum: number, horseNum: number): string {
    const param = this.allParams.find(p => 
      p.raceNum === raceNum && p.horseNum === horseNum
    );
    return param?.horseName || '';
  }

  isHorseWithdrawn(raceNum: number, horseNum: number): boolean {
    const param = this.allParams.find(p => 
      p.raceNum === raceNum && p.horseNum === horseNum
    );
    return param?.special != null;
  }

  isBetBeforeSpecial(item: any): boolean {
    // Find any horse in the race that has a special date
    const raceParams = this.allParams.filter(p => p.raceNum === item.raceNum);
    
    for (const param of raceParams) {
      if (param.special) {
        const specialDate = new Date(param.special);
        const betTime = new Date(item.betTime || item.createdAt);
        if (betTime < specialDate) {
          return true;
        }
      }
    }
    return false;
  }

  isHorseRule4(raceNum: number, horseNum: number): boolean {
    const param = this.allParams.find(p => 
      p.raceNum === raceNum && p.horseNum === horseNum
    );
    return param?.rule4 != null;
  }

  hasRule4Applies(item: any): boolean {
    // Check if any horse in the race has a rule4 date after this bet was placed
    const raceParams = this.allParams.filter(p => p.raceNum === item.raceNum);
    const betTime = new Date(item.betTime || item.createdAt);
    
    for (const param of raceParams) {
      if (param.rule4) {
        const rule4Date = new Date(param.rule4);
        if (betTime < rule4Date) {
          return true;
        }
      }
    }
    return false;
  }

  printList() {
    window.print();
  }
}
