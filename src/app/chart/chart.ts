import { Component, OnInit, ChangeDetectorRef, ViewChild, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSidenav, MatSidenavContent } from '@angular/material/sidenav';
import { RecentClientsService } from '../services/recent-clients.service';
import { MeetingDataService } from '../services/meeting-data.service';
import { OfflineStoreService } from '../services/offline-store.service';
import { environment } from '../../environments/environment';

interface Horse {
  horseNum: number;
  horseName: string;
  books: number;
  profitLoss: number;
  hasSpecial: boolean;
  hasRule4: boolean;
  avg: number;
  isWinner: boolean;
}

interface Race {
  raceNum: number;
  horses: Horse[];
  hasWinner: boolean;
  totalAvg: number;
}

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatSidenavModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule
  ],
  templateUrl: './chart.html',
  styleUrl: './chart.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Chart implements OnInit {
  private apiUrl = `${environment.apiUrl}/api`;
  
  @ViewChild('sidenav') sidenav!: MatSidenav;
  @ViewChild('sidenavContent') sidenavContent!: MatSidenavContent;
  
  races: Race[] = [];
  loading: boolean = true;
  meetingName: string = '';
  
  // Recent clients
  recentClients: string[] = [];
  
  // Last saved bet
  lastBet: any = null;
  
  // Betslip form fields
  selectedRaceNum: number | null = null;
  betslipHorses: any[] = [];
  betslipSelectedHorseNum: number | null = null;
  betslipSelectedHorseName: string = '';
  clientName: string = '';
  betType: string = 'sales';
  oddsType: string = 'f500';
  stakeBooks: number | null = null;
  odds: number | null = null;
  tax: number | null = 5;
  
  stakeBooksError: string = '';
  oddsError: string = '';
  
  // Cache data
  private allParams: any[] = [];
  private allBets: any[] = [];
  
  private meetingData = inject(MeetingDataService);
  private offlineStore = inject(OfflineStoreService);

  constructor(
    private http: HttpClient, 
    private cdr: ChangeDetectorRef,
    private recentClientsService: RecentClientsService
  ) {}
  
  ngOnInit() {
    this.loadData();
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
  
  async loadData() {
    try {
      // Load selected races first
      const selectedRaces = await this.meetingData.getSelectedRaces();
      
      if (!selectedRaces || selectedRaces.length === 0) {
        this.loading = false;
        return;
      }
      
      this.meetingName = this.meetingData.getMeetingName();
      
      // Load params and bets in parallel (shared cache)
      const [params, bets] = await Promise.all([
        this.meetingData.getParams(),
        this.meetingData.getBets()
      ]);
      
      this.allParams = params;
      this.allBets = bets;
      
      // Group params by race and track special dates
      const raceMap = new Map<number, Horse[]>();
      const specialDates = new Map<string, Date>(); // key: "raceNum-horseNum", value: special date
      const rule4Info = new Map<string, { date: Date; deduct: number }>(); // key: "raceNum-horseNum"
      const rule4ByRace = new Map<number, Array<{ date: Date; deduct: number }>>(); // key: raceNum, value: array of {date, deduct}
      
      params?.forEach(param => {
        if (!raceMap.has(param.raceNum)) {
          raceMap.set(param.raceNum, []);
        }
        
        // Store special date for this horse
        if (param.special) {
          specialDates.set(`${param.raceNum}-${param.horseNum}`, new Date(param.special));
        }
        
        // Store rule4 info for this horse
        if (param.rule4) {
          const deduct = param.rule4deduct || 0;
          const rule4Date = new Date(param.rule4);
          rule4Info.set(`${param.raceNum}-${param.horseNum}`, {
            date: rule4Date,
            deduct: deduct
          });
          
          // Collect all rule4 deductions with dates in this race
          if (!rule4ByRace.has(param.raceNum)) {
            rule4ByRace.set(param.raceNum, []);
          }
          if (deduct > 0) {
            rule4ByRace.get(param.raceNum)!.push({ date: rule4Date, deduct: deduct });
          }
        }
        
        const horses = raceMap.get(param.raceNum)!;
        horses.push({
          horseNum: param.horseNum,
          horseName: param.horseName || `Horse ${param.horseNum}`,
          books: 0,
          profitLoss: 0,
          hasSpecial: !!param.special,
          hasRule4: !!param.rule4,
          avg: 0,
          isWinner: !!param.winner
        });
      });
      
      // Pre-filter and group valid bets by race
      const betsByRace = new Map<number, any[]>();
      
      bets?.forEach(bet => {
        if (bet.cancelled || !raceMap.has(bet.raceNum)) return;
        
        const horses = raceMap.get(bet.raceNum)!;
        const betTime = new Date(bet.betTime || bet.createdAt);
        
        // Check if bet should be ignored due to special dates
        let shouldIgnore = false;
        for (const horse of horses) {
          const specialDate = specialDates.get(`${bet.raceNum}-${horse.horseNum}`);
          if (specialDate && betTime < specialDate) {
            shouldIgnore = true;
            break;
          }
        }
        
        if (shouldIgnore) return;
        
        // Add to race bets
        if (!betsByRace.has(bet.raceNum)) {
          betsByRace.set(bet.raceNum, []);
        }
        betsByRace.get(bet.raceNum)!.push(bet);
      });
      
      // Calculate books and P&L for each race
      raceMap.forEach((horses, raceNum) => {
        const raceBets = betsByRace.get(raceNum) || [];
        
        // Calculate total stakes — exclude bets for special/rule4 (voided) horses
        const horsesMap = new Map(horses.map(h => [h.horseNum, h]));
        const totalStakes = raceBets.reduce((sum, bet) => {
          const h = horsesMap.get(bet.horseNum);
          if (h && (h.hasSpecial || h.hasRule4)) return sum;
          return sum + (bet.stake || 0);
        }, 0);
        const rule4Deductions = rule4ByRace.get(raceNum) || [];
        
        // Group bets by horse for efficient lookup
        const betsByHorse = new Map<number, any[]>();
        const stakesByHorse = new Map<number, number>();
        
        raceBets.forEach(bet => {
          // Skip bets for special/rule4 (voided) horses
          const betHorse = horsesMap.get(bet.horseNum);
          if (betHorse && (betHorse.hasSpecial || betHorse.hasRule4)) return;

          if (!betsByHorse.has(bet.horseNum)) {
            betsByHorse.set(bet.horseNum, []);
            stakesByHorse.set(bet.horseNum, 0);
          }
          betsByHorse.get(bet.horseNum)!.push(bet);
          
          // Accumulate stakes for this horse
          stakesByHorse.set(bet.horseNum, (stakesByHorse.get(bet.horseNum) || 0) + (bet.stake || 0));
          
          // Add to books with Rule 4 adjustments
          if (betHorse && bet.books) {
            let adjustedBooks = bet.books;
            const betTime = new Date(bet.betTime || bet.createdAt);
            
            // Apply rule4 deductions that occurred AFTER this bet was placed
            rule4Deductions.forEach(r4 => {
              if (betTime < r4.date) {
                adjustedBooks = adjustedBooks * (1 - r4.deduct / 100);
              }
            });
            
            betHorse.books += adjustedBooks;
          }
        });
        
        // Calculate P&L and Avg for each horse
        horses.forEach(horse => {
          const horseBets = betsByHorse.get(horse.horseNum) || [];
          const horseStakes = stakesByHorse.get(horse.horseNum) || 0;
          
          // Calculate Avg: total stake / total books
          horse.avg = horse.books !== 0 ? horseStakes / horse.books : 0;
          
          // Calculate total payout with applicable rule4 deductions
          let totalPayout = 0;
          const allRule4s = rule4ByRace.get(raceNum) || [];
          
          horseBets.forEach(bet => {
            let payout = bet.payout || 0;
            const betTime = new Date(bet.betTime || bet.createdAt);
            
            // Apply only rule4 deductions that occurred AFTER this bet was placed
            const applicableRule4s = allRule4s.filter(r4 => betTime < r4.date);
            applicableRule4s.forEach(r4 => {
              payout = payout * (1 - r4.deduct / 100);
            });
            
            totalPayout += payout;
          });
          
          // P&L = total stakes in race - payout if this horse wins
          horse.profitLoss = totalStakes - totalPayout;
        });
      });
      
      // Convert map to array and sort
      this.races = Array.from(raceMap.entries())
        .map(([raceNum, horses]) => ({
          raceNum,
          horses: horses.sort((a, b) => a.horseNum - b.horseNum),
          hasWinner: horses.some(h => h.isWinner),
          totalAvg: horses.filter(h => !h.hasSpecial && !h.hasRule4).reduce((sum, h) => sum + h.avg, 0)
        }))
        .sort((a, b) => a.raceNum - b.raceNum);
      
      this.loading = false;
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading data:', error);
      this.loading = false;
      this.cdr.detectChanges();
    }
  }
  
  // Helper to create pairs of races for side-by-side display
  getRacePairs(): Race[][] {
    const pairs: Race[][] = [];
    for (let i = 0; i < this.races.length; i += 2) {
      if (i + 1 < this.races.length) {
        pairs.push([this.races[i], this.races[i + 1]]);
      } else {
        pairs.push([this.races[i]]);
      }
    }
    return pairs;
  }

  openBetslip(raceNum: number, horseNum: number) {
    // Check if race has a winner
    const race = this.races.find(r => r.raceNum === raceNum);
    if (race && race.hasWinner) {
      return; // Don't open betslip if race has a winner
    }
    
    this.selectedRaceNum = raceNum;
    
    // Get horses for this race
    const raceParams = this.allParams.filter(p => p.raceNum === raceNum);
    this.betslipHorses = raceParams.map(p => ({
      horseNum: p.horseNum,
      horseName: p.horseName || `Horse ${p.horseNum}`,
      hasSpecial: !!p.special,
      hasRule4: !!p.rule4
    }));
    
    // Select the clicked horse
    this.selectBetslipHorse(horseNum);
    
    // Open sidenav - it always overlays the current viewport because the
    // container is exactly 100dvh tall and content scrolls inside it
    this.sidenav.open();
  }

  selectBetslipHorse(horseNum: number) {
    // Prevent selection if horse has special or rule4
    const horse = this.betslipHorses.find(h => h.horseNum === horseNum);
    if (horse && (horse.hasSpecial || horse.hasRule4)) {
      return;
    }
    
    this.betslipSelectedHorseNum = horseNum;
    this.betslipSelectedHorseName = horse ? horse.horseName : '';
  }

  onClientNameInput() {
    this.clientName = this.clientName.toUpperCase();
  }

  saveBet() {
    if (!this.selectedRaceNum) {
      alert('Please select a race');
      return;
    }
    
    if (!this.betslipSelectedHorseNum) {
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
    
    const betData: any = {
      meetingName: this.meetingName,
      raceNum: this.selectedRaceNum,
      horseNum: this.betslipSelectedHorseNum,
      horseName: this.betslipSelectedHorseName,
      clientName: this.clientName,
      tax: this.tax,
      betTime: new Date()
    };

    betData.clientRequestId = this.offlineStore.generateRequestId();
    
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
    
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.resetBetslipForm();
      this.offlineStore.queueBet(betData).then(async () => {
        this.meetingData.addLocalBet(betData);
        await this.loadData();
        alert('Saved offline. Will sync when online.');
      });
      return;
    }

    this.resetBetslipForm();
    this.http.post(`${this.apiUrl}/bets`, betData).subscribe({
      next: async () => {
        this.meetingData.invalidateBets();
        await this.loadRecentClients();
        await this.loadLastBet();
        
        // Reload data
        await this.loadData();
      },
      error: (error) => {
        console.error('Error saving bet:', error);
        alert('Error saving bet. Please try again.');
      }
    });
  }

  resetBetslipForm() {
    this.betslipSelectedHorseNum = null;
    this.betslipSelectedHorseName = '';
    this.clientName = '';
    this.stakeBooks = null;
    this.odds = null;
    this.tax = 5;
    this.oddsType = 'f500';
    this.betType = 'sales';
    this.cdr.detectChanges();
  }

  closeSidenav() {
    this.resetBetslipForm();
    this.sidenav.close();
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
