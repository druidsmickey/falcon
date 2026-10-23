import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { environment } from '../../environments/environment';
import { MeetingDataService } from '../services/meeting-data.service';

interface ClientReport {
  clientName: string;
  totalStake: number;
  totalTax: number;
  totalPayout: number;
  profitLoss: number;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule],
  templateUrl: './reports.html',
  styleUrl: './reports.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reports implements OnInit {
  private apiUrl = `${environment.apiUrl}/api`;
  
  allBets: any[] = [];
  allParams: any[] = [];
  clientReports: Map<string, ClientReport> = new Map();
  groupedItems: Map<string, any[]> = new Map();
  horseNamesByRace: string[][] = [];
  
  showSummaryOnly: boolean = false;
  filterClientName: string = '';
  meetingName: string = '';
  addonValues: { [clientName: string]: number } = {};
  savedAddonValues: { [clientName: string]: number } = {};
  manualAddonClients: string[] = [];
  newAddonClientName: string = '';
  newAddonValue: number = 0;
  
  // Cache for special and rule4 dates
  private specialDates = new Map<string, Date>();
  private rule4Info = new Map<number, Array<{ date: Date; deduct: number }>>();
  // Pre-built lookup maps for O(1) access
  private winnerSet = new Set<string>(); // "raceNum-horseNum" keys
  private winnerCountByRace = new Map<number, number>();
  private rule4HorseSet = new Set<string>(); // "raceNum-horseNum" keys with rule4
  private specialHorseSet = new Set<string>(); // keys of horses with special dates

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
      this.allBets = bets;
      
      // Build special dates and rule4 info maps
      this.buildDateMaps();
      
      // Calculate reports
      this.calculateClientReports();
      this.groupBetsByClient();
      await this.loadAddons();
      
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  async loadAddons() {
    if (!this.meetingName) return;
    try {
      const addons = await this.http
        .get<any[]>(`${this.apiUrl}/reports/addon/${encodeURIComponent(this.meetingName)}`)
        .toPromise();
      this.addonValues = {};
      this.savedAddonValues = {};
      this.manualAddonClients = [];
      (addons || []).forEach(a => {
        if (a.clientName && a.stake != null) {
          this.addonValues[a.clientName] = a.stake;
          this.savedAddonValues[a.clientName] = a.stake;
          // If this client has no bets, treat as a manual addon client
          if (!this.groupedItems.has(a.clientName)) {
            this.manualAddonClients.push(a.clientName);
          }
        }
      });
    } catch (e) {
      console.error('Error loading add-ons:', e);
    }
  }

  deleteManualAddonClient(clientName: string) {
    if (!confirm(`Delete Add-On for "${clientName}"?`)) return;
    this.manualAddonClients = this.manualAddonClients.filter(c => c !== clientName);
    delete this.addonValues[clientName];
    delete this.savedAddonValues[clientName];
    this.http.delete(`${this.apiUrl}/reports/addon/${encodeURIComponent(this.meetingName)}/${encodeURIComponent(clientName)}`)
      .subscribe({ error: (e) => console.error('Error deleting add-on:', e) });
    this.cdr.detectChanges();
  }

  deleteAddon(clientName: string) {
    if (!confirm(`Delete Add-On for "${clientName}"?`)) return;
    delete this.addonValues[clientName];
    delete this.savedAddonValues[clientName];
    this.http.delete(`${this.apiUrl}/reports/addon/${encodeURIComponent(this.meetingName)}/${encodeURIComponent(clientName)}`)
      .subscribe({ error: (e) => console.error('Error deleting add-on:', e) });
    this.cdr.detectChanges();
  }

  addManualAddonClient() {
    const name = this.newAddonClientName.trim().toUpperCase();
    if (!name) return;
    
    const value = Number(this.newAddonValue ?? 0);
    
    // If client doesn't have bets, add to manual addon list
    if (!this.groupedItems.has(name) && !this.manualAddonClients.includes(name)) {
      this.manualAddonClients.push(name);
    }
    
    this.addonValues[name] = value;
    this.savedAddonValues[name] = value;
    this.newAddonClientName = '';
    this.newAddonValue = 0;
    
    // Persist to DB immediately
    this.http.post(`${this.apiUrl}/reports/addon`, {
      meetingName: this.meetingName,
      clientName: name,
      stake: value
    }).subscribe({ error: (e) => console.error('Error saving add-on:', e) });
    this.cdr.detectChanges();
  }

  getAdjustedPLForGroup(bets: any[], clientName: string): number {
    return this.getProfitLossForGroup(bets) + Number(this.savedAddonValues[clientName] || 0);
  }

  buildDateMaps() {
    this.specialDates.clear();
    this.rule4Info.clear();
    this.winnerSet.clear();
    this.winnerCountByRace.clear();
    this.rule4HorseSet.clear();
    this.specialHorseSet.clear();
    
    // Build horse names array
    const maxRace = Math.max(...this.allParams.map(p => p.raceNum), 0);
    this.horseNamesByRace = Array.from({ length: maxRace }, () => []);
    
    this.allParams.forEach(param => {
      const key = `${param.raceNum}-${param.horseNum}`;
      
      // Store horse name
      if (param.raceNum > 0 && param.horseNum > 0) {
        const raceIndex = param.raceNum - 1;
        const horseIndex = param.horseNum - 1;
        if (!this.horseNamesByRace[raceIndex]) {
          this.horseNamesByRace[raceIndex] = [];
        }
        this.horseNamesByRace[raceIndex][horseIndex] = param.horseName || `Horse ${param.horseNum}`;
      }
      
      if (param.special) {
        this.specialDates.set(key, new Date(param.special));
        this.specialHorseSet.add(key);
      }
      
      if (param.winner) {
        this.winnerSet.add(key);
        this.winnerCountByRace.set(param.raceNum, (this.winnerCountByRace.get(param.raceNum) || 0) + 1);
      }
      
      if (param.rule4) {
        this.rule4HorseSet.add(key);
        if (param.rule4deduct > 0) {
          if (!this.rule4Info.has(param.raceNum)) {
            this.rule4Info.set(param.raceNum, []);
          }
          this.rule4Info.get(param.raceNum)!.push({
            date: new Date(param.rule4),
            deduct: param.rule4deduct
          });
        }
      }
    });
  }

  calculateClientReports() {
    this.clientReports.clear();
    
    // Process each bet
    this.allBets.forEach(bet => {
      if (bet.cancelled) return;
      
      const betTime = new Date(bet.betTime || bet.createdAt);
      
      // Check if ANY horse in this race was withdrawn special before this bet
      // This matches the isSpecial() logic - all bets in race before withdrawal are ignored
      const raceParams = this.allParams.filter(p => p.raceNum === bet.raceNum);
      const hasSpecialWithdrawal = raceParams.some(p => {
        const key = `${p.raceNum}-${p.horseNum}`;
        const specialDate = this.specialDates.get(key);
        return specialDate && betTime < specialDate;
      });
      
      if (hasSpecialWithdrawal) {
        return; // Ignore all bets in race before special withdrawal
      }
      
      const key = `${bet.raceNum}-${bet.horseNum}`;
      // Check if horse has rule4
      const hasRule4 = this.rule4HorseSet.has(key);
      
      // If horse withdrawn due to rule4 with betTime before rule4 date, ignore
      if (hasRule4) {
        const rule4s = this.rule4Info.get(bet.raceNum) || [];
        const firstRule4 = rule4s[0];
        if (firstRule4 && betTime < firstRule4.date) {
          return; // Ignore bets placed before rule4 (horse withdrawn)
        }
      }
      
      const clientName = bet.clientName || 'Unknown';
      
      if (!this.clientReports.has(clientName)) {
        this.clientReports.set(clientName, {
          clientName,
          totalStake: 0,
          totalTax: 0,
          totalPayout: 0,
          profitLoss: 0
        });
      }
      
      const report = this.clientReports.get(clientName)!;
      
      // Calculate stake (negative for purchase)
      const stake = bet.stake || 0;
      report.totalStake += stake;
      
      // Calculate tax: (tax% / 100) * stake (negative for purchase)
      const taxAmount = ((bet.tax || 0) / 100) * stake;
      report.totalTax += taxAmount;
      
      // Calculate payout with rule4 deductions (only for winners)
      if (this.isWinner(bet)) {
        let payout = bet.payout || 0;
        
        // Apply rule4 deductions that occurred AFTER this bet was placed
        const rule4s = this.rule4Info.get(bet.raceNum) || [];
        rule4s.forEach(r4 => {
          if (betTime < r4.date) {
            payout = payout * (1 - r4.deduct / 100);
          }
        });
        
        // Adjust for dead heat
        const winnerCount = this.winnerCountByRace.get(bet.raceNum) || 0;
        if (winnerCount > 1) {
          payout = payout / winnerCount;
        }
        
        report.totalPayout += payout;
      }
    });
    
    // Calculate profit/loss for each client: (stake + tax) - payout
    this.clientReports.forEach(report => {
      report.profitLoss = (report.totalStake + report.totalTax) - report.totalPayout;
    });
  }

  groupBetsByClient() {
    this.groupedItems.clear();
    
    this.allBets.forEach(bet => {
      const clientName = bet.clientName || 'Unknown';
      
      if (!this.groupedItems.has(clientName)) {
        this.groupedItems.set(clientName, []);
      }
      
      this.groupedItems.get(clientName)!.push({
        ...bet,
        date: new Date(bet.betTime || bet.createdAt)
      });
    });
  }

  getStakeAmountForGroup(bets: any[]): number {
    return bets
      .filter(bet => !bet.cancelled && !this.shouldIgnoreBet(bet))
      .reduce((sum, bet) => sum + (bet.stake || 0), 0);
  }

  getTaxAmountForGroup(bets: any[]): number {
    return bets
      .filter(bet => !bet.cancelled && !this.shouldIgnoreBet(bet))
      .reduce((sum, bet) => {
        const stake = bet.stake || 0;
        const taxAmount = ((bet.tax || 0) / 100) * stake;
        return sum + taxAmount;
      }, 0);
  }

  getProfitLossForGroup(bets: any[]): number {
    let totalStake = 0;
    let totalPayout = 0;
    let totalTax = 0;
    
    bets.forEach(bet => {
      if (bet.cancelled || this.shouldIgnoreBet(bet)) return;
      
      const stake = bet.stake || 0;
      totalStake += stake;
      
      const taxAmount = ((bet.tax || 0) / 100) * stake;
      totalTax += taxAmount;
      
      // Calculate payout with rule4 deductions (only for winners)
      if (this.isWinner(bet)) {
        let payout = bet.payout || 0;
        const betTime = new Date(bet.betTime || bet.createdAt);
        const rule4s = this.rule4Info.get(bet.raceNum) || [];
        
        // Adjust for dead heat
        const winnerCount = this.winnerCountByRace.get(bet.raceNum) || 0;
        if (winnerCount > 1) {
          payout = payout / winnerCount;
        }
        
        rule4s.forEach(r4 => {
          if (betTime < r4.date) {
            payout = payout * (1 - r4.deduct / 100);
          }
        });
        
        totalPayout += payout;
      }
    });
    
    return (totalStake + totalTax) - totalPayout;
  }

  shouldIgnoreBet(bet: any): boolean {
    // Ignore bets that are marked as With-Sp or With-R4
    if (this.isSpecial(bet) || this.isRule4(bet)) {
      return true;
    }
    
    return false;
  }

  getNetTotalTaxAmount(): number {
    let total = 0;
    this.clientReports.forEach((report, clientName) => {
      const adj = report.profitLoss + Number(this.savedAddonValues[clientName] || 0);
      if (adj >= 0) total += report.totalTax;
    });
    return total;
  }

  getNetTotalProfitLoss(): number {
    let total = 0;
    this.clientReports.forEach((report, clientName) => {
      const adj = report.profitLoss + Number(this.savedAddonValues[clientName] || 0);
      if (adj >= 0) total += adj;
    });
    this.manualAddonClients.forEach(clientName => {
      const adj = Number(this.savedAddonValues[clientName] || 0);
      if (adj >= 0) total += adj;
    });
    return total;
  }

  getNetTotalTaxAmountLoss(): number {
    let total = 0;
    this.clientReports.forEach((report, clientName) => {
      const adj = report.profitLoss + Number(this.savedAddonValues[clientName] || 0);
      if (adj < 0) total += report.totalTax;
    });
    return total;
  }

  getNetTotalLoss(): number {
    let total = 0;
    this.clientReports.forEach((report, clientName) => {
      const adj = report.profitLoss + Number(this.savedAddonValues[clientName] || 0);
      if (adj < 0) total += adj;
    });
    this.manualAddonClients.forEach(clientName => {
      const adj = Number(this.savedAddonValues[clientName] || 0);
      if (adj < 0) total += adj;
    });
    return total;
  }

  getNetTotalProfitLossUnadjusted(): number {
    let total = 0;
    this.clientReports.forEach((report, clientName) => {
      const adj = report.profitLoss + Number(this.savedAddonValues[clientName] || 0);
      if (adj >= 0) total += (report.profitLoss - report.totalTax);
    });
    return total;
  }

  getNetTotalLossUnadjusted(): number {
    let total = 0;
    this.clientReports.forEach((report, clientName) => {
      const adj = report.profitLoss + Number(this.savedAddonValues[clientName] || 0);
      if (adj < 0) total += (report.profitLoss - report.totalTax);
    });
    return total;
  }

  compareKeysAsc(a: any, b: any): number {
    return a.key.localeCompare(b.key);
  }

  trackClientKey(index: number, item: any): string {
    return item.key;
  }

  trackItemId(index: number, item: any): string {
    return item._id || index.toString();
  }

  isSpecial(bet: any): boolean {
    // Check if ANY horse in the race was withdrawn special
    // and if this bet was placed before that withdrawal
    const betTime = new Date(bet.betTime || bet.createdAt);
    
    // Check all horses in this race for special withdrawals
    const raceParams = this.allParams.filter(p => p.raceNum === bet.raceNum);
    return raceParams.some(p => {
      const key = `${p.raceNum}-${p.horseNum}`;
      const specialDate = this.specialDates.get(key);
      // If this horse was withdrawn and bet was before withdrawal, mark as special
      return specialDate && betTime < specialDate;
    });
  }

  isRule4(bet: any): boolean {
    // Check if the specific horse has rule4 flag set
    return this.rule4HorseSet.has(`${bet.raceNum}-${bet.horseNum}`);
  }

  isWinner(bet: any): boolean {
    return this.winnerSet.has(`${bet.raceNum}-${bet.horseNum}`);
  }

  getWinnerStatus(bet: any): string {
    return 'Winner';
  }

  getDividedPayout(bet: any): number {
    let payout = bet.payout || 0;
    const betTime = new Date(bet.betTime || bet.createdAt);
    const rule4s = this.rule4Info.get(bet.raceNum) || [];
    
    rule4s.forEach(r4 => {
      if (betTime < r4.date) {
        payout = payout * (1 - r4.deduct / 100);
      }
    });
    
    return payout;
  }

  hasRule4Deduction(bet: any): boolean {
    const betTime = new Date(bet.betTime || bet.createdAt);
    const rule4s = this.rule4Info.get(bet.raceNum) || [];
    
    // Check if any rule4 deduction applies (bet was before rule4 date)
    return rule4s.some(r4 => betTime < r4.date);
  }

  getRule4Deductions(bet: any): string {
    const betTime = new Date(bet.betTime || bet.createdAt);
    const rule4s = this.rule4Info.get(bet.raceNum) || [];
    
    // Get all applicable deductions
    const deductions = rule4s
      .filter(r4 => betTime < r4.date)
      .map(r4 => `${r4.deduct}%`);
    
    return deductions.length > 0 ? `(${deductions.join(' ')})` : '';
  }

  printProfit() {
    window.print();
  }

  get filteredGroupedItems() {
    if (!this.filterClientName || this.filterClientName.trim() === '') {
      return this.groupedItems;
    }

    const filter = this.filterClientName.toLowerCase().trim();
    const filtered = new Map<string, any[]>();

    this.groupedItems.forEach((value, key) => {
      if (key.toLowerCase().includes(filter)) {
        filtered.set(key, value);
      }
    });

    return filtered;
  }

  hasActiveBets(bets: any[]): boolean {
    return bets.some(bet => !bet.cancelled && !this.shouldIgnoreBet(bet));
  }

  isFirstVisibleBet(bets: any[], currentBet: any): boolean {
    const firstNonCancelled = bets.find(bet => !bet.cancelled);
    return firstNonCancelled === currentBet;
  }

  getWinnerCountForRace(raceNum: number): number {
    // Only count winners that are not special (withdrawn)
    return this.allParams.filter(p => {
      if (p.raceNum !== raceNum || !p.winner) return false;
      // Exclude if horse was made special (withdrawn)
      const key = `${p.raceNum}-${p.horseNum}`;
      const specialDate = this.specialDates.get(key);
      if (specialDate && p.special && new Date(p.special) <= specialDate) {
        return false;
      }
      return true;
    }).length;
  }

  isDeadHeat(bet: any): boolean {
    return this.getWinnerCountForRace(bet.raceNum) > 1;
  }

  getAdjustedPayout(bet: any): number {
    let payout = this.getDividedPayout(bet);
    const winnerCount = this.getWinnerCountForRace(bet.raceNum);
    
    if (winnerCount > 1) {
      payout = payout / winnerCount;
    }
    
    return payout;
  }
}
