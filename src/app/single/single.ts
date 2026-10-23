import { Component, OnInit, ChangeDetectorRef, ViewChild, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSidenav } from '@angular/material/sidenav';
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
  numHorse: number;
  meetingName: string;
}

@Component({
  selector: 'app-single',
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
  templateUrl: './single.html',
  styleUrl: './single.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Single implements OnInit {
  private apiUrl = `${environment.apiUrl}/api`;
  
  @ViewChild('sidenav') sidenav!: MatSidenav;
  
  races: Race[] = [];
  selectedRaceNum: number | null = null;
  horses: Horse[] = [];
  loading: boolean = false;
  meetingName: string = '';
  totalAvg: number = 0;
  hasWinner: boolean = false;
  
  stakeBooksError: string = '';
  oddsError: string = '';
  
  // Cache data to avoid reloading
  private cachedParams: any[] | null = null;
  private cachedBets: any[] | null = null;
  
  // Recent clients
  recentClients: string[] = [];
  
  // Last saved bet
  lastBet: any = null;
  
  // Betslip form fields
  betslipHorses: any[] = [];
  betslipSelectedHorseNum: number | null = null;
  betslipSelectedHorseName: string = '';
  clientName: string = '';
  betType: string = 'sales';
  oddsType: string = 'f500';
  stakeBooks: number | null = null;
  odds: number | null = null;
  tax: number | null = 5;
  
  private meetingData = inject(MeetingDataService);
  private offlineStore = inject(OfflineStoreService);

  constructor(
    private http: HttpClient, 
    private cdr: ChangeDetectorRef,
    private recentClientsService: RecentClientsService
  ) {}
  
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
    this.loading = true;
    try {
      const races = await this.meetingData.getSelectedRaces();
      if (races.length === 0) {
        this.loading = false;
        this.cdr.detectChanges();
        return;
      }
      
      this.races = races;
      this.meetingName = this.meetingData.getMeetingName();
      
      await this.loadAndCacheData();
      
      if (races.length > 0) {
        this.selectedRaceNum = races[0].raceNum;
        this.loadRaceData();
      }
      
      this.loading = false;
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading races:', error);
      this.loading = false;
      this.cdr.detectChanges();
    }
  }
  
  async loadAndCacheData() {
    try {
      const [params, bets] = await Promise.all([
        this.meetingData.getParams(),
        this.meetingData.getBets()
      ]);
      
      this.cachedParams = params;
      this.cachedBets = bets;
    } catch (error) {
      console.error('Error loading data:', error);
      this.cachedParams = [];
      this.cachedBets = [];
    }
  }
  
  selectRace(raceNum: number) {
    this.selectedRaceNum = raceNum;
    setTimeout(() => {
      this.loadRaceData();
    }, 0);
  }
  
  loadRaceData() {
    if (!this.selectedRaceNum || !this.cachedParams || !this.cachedBets) return;
    
    // Filter params for selected race
    const raceParams = this.cachedParams.filter(p => p.raceNum === this.selectedRaceNum);
    
    // Track special and rule4 dates
    const specialDates = new Map<number, Date>();
    const rule4Info: Array<{ date: Date; deduct: number }> = [];
    
    // Build horses array with Map for faster lookup
    const horsesMap = new Map<number, Horse>();
    
    raceParams.forEach(param => {
      if (param.special) {
        specialDates.set(param.horseNum, new Date(param.special));
      }
      
      if (param.rule4 && param.rule4deduct > 0) {
        rule4Info.push({
          date: new Date(param.rule4),
          deduct: param.rule4deduct
        });
      }
      
      const horse: Horse = {
        horseNum: param.horseNum,
        horseName: param.horseName || `Horse ${param.horseNum}`,
        books: 0,
        profitLoss: 0,
        hasSpecial: !!param.special,
        hasRule4: !!param.rule4,
        avg: 0,
        isWinner: !!param.winner
      };
      horsesMap.set(param.horseNum, horse);
    });
      
      // Pre-filter bets and group by horse for efficient processing
      const betsByHorse = new Map<number, any[]>();
      const stakesByHorse = new Map<number, number>();
      let totalStakes = 0;
      
      this.cachedBets.forEach(b => {
        if (b.raceNum !== this.selectedRaceNum || b.cancelled) return;
        
        const betTime = new Date(b.betTime || b.createdAt);
        
        // Check special dates
        for (const [horseNum, specialDate] of specialDates.entries()) {
          if (betTime < specialDate) return;
        }

        // Skip bets for special/rule4 horses — they are voided, don't affect P&L
        const betHorse = horsesMap.get(b.horseNum);
        if (betHorse && (betHorse.hasSpecial || betHorse.hasRule4)) return;
        
        // Add to total stakes
        totalStakes += (b.stake || 0);
        
        // Group by horse
        if (!betsByHorse.has(b.horseNum)) {
          betsByHorse.set(b.horseNum, []);
          stakesByHorse.set(b.horseNum, 0);
        }
        betsByHorse.get(b.horseNum)!.push(b);
        
        // Accumulate stakes for this horse
        stakesByHorse.set(b.horseNum, (stakesByHorse.get(b.horseNum) || 0) + (b.stake || 0));
        
        // Add to books with Rule 4 adjustments
        const horse = horsesMap.get(b.horseNum);
        if (horse && b.books) {
          let adjustedBooks = b.books;
          const betTime = new Date(b.betTime || b.createdAt);
          
          // Apply rule4 deductions that occurred AFTER this bet was placed
          rule4Info.forEach(r4 => {
            if (betTime < r4.date) {
              adjustedBooks = adjustedBooks * (1 - r4.deduct / 100);
            }
          });
          
          horse.books += adjustedBooks;
        }
      });
      
      // Calculate P&L and Avg for each horse
      horsesMap.forEach((horse, horseNum) => {
        const horseBets = betsByHorse.get(horseNum) || [];
        const horseStakes = stakesByHorse.get(horseNum) || 0;
        
        // Calculate Avg: total stake / total books
        horse.avg = horse.books !== 0 ? horseStakes / horse.books : 0;
        
        let totalPayout = 0;
        horseBets.forEach(bet => {
          let payout = bet.payout || 0;
          const betTime = new Date(bet.betTime || bet.createdAt);
          
          // Apply only rule4 deductions that occurred AFTER this bet was placed
          rule4Info.forEach(r4 => {
            if (betTime < r4.date) {
              payout = payout * (1 - r4.deduct / 100);
            }
          });
          
          totalPayout += payout;
        });
        
        horse.profitLoss = totalStakes - totalPayout;
      });
      
      // Calculate total average: exclude special/rule4 horses
      this.totalAvg = Array.from(horsesMap.values())
        .filter(h => !h.hasSpecial && !h.hasRule4)
        .reduce((sum, h) => sum + h.avg, 0);
      
      // Convert map to sorted array
      this.horses = Array.from(horsesMap.values()).sort((a, b) => a.horseNum - b.horseNum);
      
      // Defer change detection to next cycle to avoid ExpressionChangedAfterItHasBeenCheckedError
      setTimeout(() => {
        this.hasWinner = this.horses.some(h => h.isWinner);
        this.cdr.detectChanges();
      }, 0);
  }
  
  openBetslip(horse: Horse) {
    if (!this.selectedRaceNum) return;
    
    // Prevent opening betslip if race has a winner
    if (this.hasWinner) {
      return;
    }
    
    // Prevent opening betslip for horses with special or rule4
    if (horse.hasSpecial || horse.hasRule4) {
      return;
    }
    
    // Set race and horse for betslip
    this.betslipSelectedHorseNum = horse.horseNum;
    this.betslipSelectedHorseName = horse.horseName;
    
    // Load horses for the selected race in betslip
    this.betslipHorses = this.horses.map(h => ({
      horseNum: h.horseNum,
      horseName: h.horseName,
      hasSpecial: h.hasSpecial,
      hasRule4: h.hasRule4
    }));
    
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
        this.cachedBets = await this.meetingData.getBets();
        this.loadRaceData();
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
        
        // Reload cached bets to update chart
        this.cachedBets = await this.meetingData.getBets();
        
        this.loadRaceData();
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
