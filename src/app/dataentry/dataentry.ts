import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatRadioModule } from '@angular/material/radio';
import { MatChipsModule } from '@angular/material/chips';
import { RecentClientsService } from '../services/recent-clients.service';
import { MeetingDataService } from '../services/meeting-data.service';
import { OfflineStoreService } from '../services/offline-store.service';
import { Bet, BetRequest, BetslipHorse, HorseParam } from '../models';

interface Race {
  raceNum: number;
  numHorse: number;
  meetingName: string;
}

interface Horse {
  horseNum: number;
  horseName: string;
  hasSpecial?: boolean;
  hasRule4?: boolean;
  isWinner?: boolean;
}

@Component({
  selector: 'app-dataentry',
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatCardModule,
    MatRadioModule,
    MatChipsModule
  ],
  templateUrl: './dataentry.html',
  styleUrl: './dataentry.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dataentry implements OnInit {
  private cdr = inject(ChangeDetectorRef);
  private recentClientsService = inject(RecentClientsService);

races: Race[] = [];
  horses: Horse[] = [];
  meetingName: string = '';
  
  // Cache all params data
  private allParams: HorseParam[] = [];
  
  // Track if selected race has a winner
  selectedRaceHasWinner: boolean = false;
  stakeBooksError: string = '';
  oddsError: string = '';
  
  // Recent clients
  recentClients: string[] = [];
  
  // Last saved bet
  lastBet: Bet | null = null;
  
  // Betslip form
  selectedRaceNum: number | null = null;
  selectedHorseNum: number | null = null;
  selectedHorseName: string = '';
  clientName: string = '';
  betType: string = 'sales'; // 'sales' or 'purchase'
  oddsType: string = 'f500'; // 'f500' or 'odds'
  
  // Bet fields
  stake: number | null = null;
  odds: number | null = null;
  stakeBooks: number | null = null;
  oddsF500: number | null = null;
  tax: number | null = 5;
  odds100: number | null = null;
  books: number | null = null;
  f500: number | null = null;
  payout: number | null = null;

  private meetingData = inject(MeetingDataService);
  private offlineStore = inject(OfflineStoreService);

  ngOnInit() {
    this.loadSelectedRaces();
    this.loadRecentClients();
    this.loadLastBet();
  }
  
  async loadRecentClients() {
    this.recentClients = await this.recentClientsService.loadRecentClients();
    this.cdr.detectChanges();
  }
  
  async loadLastBet() {
    try {
      const bet = await this.meetingData.getLastBet();
      if (bet) {
        this.lastBet = bet;
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('Error loading last bet:', error);
    }
  }
  
  selectClient(clientName: string) {
    this.clientName = clientName;
    this.cdr.detectChanges();
  }

  async loadSelectedRaces() {
    try {
      const races = await this.meetingData.getSelectedRaces();
      if (races.length === 0) {
        alert('No selected races found. Please select a meeting in the Init page first.');
        return;
      }
      this.races = races;
      this.meetingName = this.meetingData.getMeetingName();
      await this.loadAllParams();
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading races:', error);
      alert('Error loading races. Please check if the backend is running.');
    }
  }

  async loadAllParams() {
    try {
      this.allParams = await this.meetingData.getParams();
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading params:', error);
    }
  }

  onRaceChange() {
    if (!this.selectedRaceNum) {
      this.selectedRaceHasWinner = false;
      return;
    }
    
    // Reset selected horse when race changes
    this.selectedHorseNum = null;
    this.selectedHorseName = '';
    
    // Use cached params data instead of making HTTP request
    this.horses = this.allParams
      .filter(p => p.raceNum === this.selectedRaceNum)
      .map(p => ({
        horseNum: p.horseNum,
        horseName: p.horseName || `Horse ${p.horseNum}`,
        hasSpecial: !!p.special,
        hasRule4: !!p.rule4,
        isWinner: !!p.winner
      }));
    
    // Check if selected race has a winner
    this.selectedRaceHasWinner = this.horses.some(h => h.isWinner);
    
    this.cdr.detectChanges();
  }

  selectRace(raceNum: number) {
    this.selectedRaceNum = raceNum;
    this.onRaceChange();
  }

  onHorseChange() {
    const horse = this.horses.find(h => h.horseNum === this.selectedHorseNum);
    this.selectedHorseName = horse ? horse.horseName : '';
  }

  selectHorse(horseNum: number) {
    this.selectedHorseNum = horseNum;
    this.onHorseChange();
  }

  onClientNameInput() {
    this.clientName = this.clientName.toUpperCase();
  }

  saveBet() {
    // Validation
    if (!this.selectedRaceNum) {
      alert('Please select a race');
      return;
    }
    
    if (!this.selectedHorseNum) {
      alert('Please select a horse');
      return;
    }
    
    if (!this.clientName) {
      alert('Please enter a client name');
      return;
    }

    if (!this.stakeBooks || !this.odds) {
        alert('Please enter odds and stake');
        return;
    }
    
    const betData: BetRequest = {
      meetingName: this.meetingName,
      raceNum: this.selectedRaceNum,
      horseNum: this.selectedHorseNum,
      horseName: this.selectedHorseName,
      clientName: this.clientName,
      tax: this.tax,
      betTime: new Date()
    };

    betData.clientRequestId = this.offlineStore.generateRequestId();
    
    // Determine multiplier based on betType
    const multiplier = this.betType === 'purchase' ? -1 : 1;
    
    if (this.oddsType === 'odds') {
      betData.odds100 = this.odds;
      betData.books = ((this.stakeBooks * this.odds) / 50000) * multiplier;
      betData.stake = this.stakeBooks * multiplier;
      betData.payout = ((this.odds * this.stakeBooks) / 100) * multiplier;
    } else {
      betData.f500 = this.odds;
      betData.books = this.stakeBooks * multiplier;
      betData.stake = (this.odds * this.stakeBooks) * multiplier;
      betData.payout = (this.stakeBooks * 500) * multiplier;
    }
    
    this.resetForm();
    this.meetingData.submitBet(betData).then(async result => {
      if (result.status === 'rejected') {
        alert(`Error saving bet: ${result.message}`);
        return;
      }

      // the recent clients come from the server, so they are only refreshed when it was reached
      if (result.status === 'saved') {
        await this.loadRecentClients();
      }
      await this.loadLastBet();
      if (result.status === 'queued') {
        alert('Saved offline. Will sync when online.');
      }
    });
  }

  resetForm() {
    this.selectedHorseNum = null;
    this.selectedHorseName = '';
    this.clientName = '';
    this.stakeBooks = null;
    this.odds = null;
    this.tax = 5;
    this.oddsType = 'f500';
    this.betType = 'sales';
    this.cdr.detectChanges();
  }

  validateStakeBooks() {
    if (this.stakeBooks !== null && this.stakeBooks !== undefined) {
      if (this.oddsType === 'f500') {
        if (this.stakeBooks < 0 || this.stakeBooks > 5000) {
          this.stakeBooks = null;
        }
      } else if (this.oddsType === 'odds') {
        if (this.stakeBooks < 100 || this.stakeBooks > 1000000) {
          this.stakeBooks = null;
        }
      }
    }
  }

  validateOdds() {
    if (this.odds !== null && this.odds !== undefined) {
      if (this.oddsType === 'f500') {
        if (this.odds < 0 || this.odds > 470) {
          this.odds = null;
        }
      } else if (this.oddsType === 'odds') {
        if (this.odds < 115 || this.odds > 10000) {
          this.odds = null;
        }
      }
    }
  }
}
