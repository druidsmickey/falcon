import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { environment } from '../../environments/environment';

interface ClientReport {
  clientName: string;
  totalStake: number;
  totalTax: number;
  totalPayout: number;
  profitLoss: number;
}

@Component({
  selector: 'app-merge',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule],
  templateUrl: './merge.html',
  styleUrl: './merge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Merge implements OnInit {
  private apiUrl = `${environment.apiUrl}/api`;
  
  allMeetings: string[] = [];
  selectedMeetings: string[] = [];
  
  allBets: any[] = [];
  allParams: any[] = [];
  clientReports: Map<string, ClientReport> = new Map();
  groupedItems: Map<string, any[]> = new Map();
  horseNamesByRace: Map<string, string[][]> = new Map(); // keyed by meetingName
  
  showSummaryOnly: boolean = false;
  filterClientName: string = '';
  addonValues: { [clientName: string]: { [meetingName: string]: number } } = {};
  savedAddonValues: { [clientName: string]: { [meetingName: string]: number } } = {};
  manualAddonClients: string[] = [];
  newAddonClientName: string = '';
  newAddonValue: number = 0;
  newAddonMeeting: string = '';
  
  // Cache for special and rule4 dates per meeting
  private specialDates = new Map<string, Date>(); // key: meetingName-raceNum-horseNum
  private rule4Info = new Map<string, Array<{ date: Date; deduct: number }>>(); // key: meetingName-raceNum

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadMeetings();
  }

  async loadMeetings() {
    try {
      const meetings = await this.http.get<string[]>(`${this.apiUrl}/meetings`).toPromise();
      this.allMeetings = meetings || [];
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading meetings:', error);
    }
  }

  toggleMeeting(meeting: string) {
    const index = this.selectedMeetings.indexOf(meeting);
    if (index === -1) {
      if (this.selectedMeetings.length >= 4) {
        alert('You can select up to 4 meetings only');
        return;
      }
      this.selectedMeetings.push(meeting);
    } else {
      this.selectedMeetings.splice(index, 1);
    }
    this.cdr.detectChanges();
  }

  isMeetingSelected(meeting: string): boolean {
    return this.selectedMeetings.includes(meeting);
  }

  async loadData() {
    if (this.selectedMeetings.length === 0) {
      alert('Please select at least one meeting');
      return;
    }

    try {
      this.allBets = [];
      this.allParams = [];
      this.horseNamesByRace.clear();
      
      // Load data for each selected meeting
      for (const meetingName of this.selectedMeetings) {
        const [params, bets] = await Promise.all([
          this.http.get<any[]>(`${this.apiUrl}/params?meetingName=${encodeURIComponent(meetingName)}`).toPromise(),
          this.http.get<any[]>(`${this.apiUrl}/bets?meetingName=${encodeURIComponent(meetingName)}`).toPromise()
        ]);
        
        this.allParams.push(...(params || []));
        this.allBets.push(...(bets || []));
      }
      
      // Build date maps and horse names
      this.buildDateMaps();
      
      // Calculate reports
      this.calculateClientReports();
      this.groupBetsByClient();

      // Build merged key and load add-ons
      await this.loadAddons();
      
      // Use setTimeout to avoid ExpressionChangedAfterItHasBeenCheckedError
      setTimeout(() => {
        this.cdr.detectChanges();
      }, 0);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  buildDateMaps() {
    this.specialDates.clear();
    this.rule4Info.clear();
    
    // Group params by meeting
    const paramsByMeeting = new Map<string, any[]>();
    this.allParams.forEach(param => {
      if (!paramsByMeeting.has(param.meetingName)) {
        paramsByMeeting.set(param.meetingName, []);
      }
      paramsByMeeting.get(param.meetingName)!.push(param);
    });
    
    // Build horse names array per meeting
    paramsByMeeting.forEach((params, meetingName) => {
      const maxRace = Math.max(...params.map(p => p.raceNum), 0);
      const horseNames: string[][] = Array.from({ length: maxRace }, () => []);
      
      params.forEach(param => {
        const key = `${meetingName}-${param.raceNum}-${param.horseNum}`;
        
        // Store horse name
        if (param.raceNum > 0 && param.horseNum > 0) {
          const raceIndex = param.raceNum - 1;
          const horseIndex = param.horseNum - 1;
          if (!horseNames[raceIndex]) {
            horseNames[raceIndex] = [];
          }
          horseNames[raceIndex][horseIndex] = param.horseName || `Horse ${param.horseNum}`;
        }
        
        if (param.special) {
          this.specialDates.set(key, new Date(param.special));
        }
        
        if (param.rule4 && param.rule4deduct > 0) {
          const raceKey = `${meetingName}-${param.raceNum}`;
          if (!this.rule4Info.has(raceKey)) {
            this.rule4Info.set(raceKey, []);
          }
          this.rule4Info.get(raceKey)!.push({
            date: new Date(param.rule4),
            deduct: param.rule4deduct
          });
        }
      });
      
      this.horseNamesByRace.set(meetingName, horseNames);
    });
  }

  calculateClientReports() {
    this.clientReports.clear();
    
    // Process each bet
    this.allBets.forEach(bet => {
      if (bet.cancelled) return;
      
      const betTime = new Date(bet.betTime || bet.createdAt);
      const clientName = bet.clientName || 'Unknown';
      
      // Check if bet should be ignored
      if (this.shouldIgnoreBet(bet)) {
        return;
      }
      
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
        const raceKey = `${bet.meetingName}-${bet.raceNum}`;
        const rule4s = this.rule4Info.get(raceKey) || [];
        rule4s.forEach(r4 => {
          if (betTime < r4.date) {
            payout = payout * (1 - r4.deduct / 100);
          }
        });
        
        // Adjust for dead heat
        const winnerCount = this.allParams.filter(p => 
          p.meetingName === bet.meetingName && 
          p.raceNum === bet.raceNum && 
          p.winner &&
          !this.isHorseSpecial(p)
        ).length;
        if (winnerCount > 1) {
          payout = payout / winnerCount;
        }
        
        report.totalPayout += payout;
      }
    });
    
    // Calculate P/L for each client
    this.clientReports.forEach(report => {
      report.profitLoss = (report.totalStake + report.totalTax) - report.totalPayout;
    });
  }

  async loadAddons() {
    // Initialize nested structure for all known clients
    this.addonValues = {};
    this.savedAddonValues = {};
    this.manualAddonClients = [];
    this.groupedItems.forEach((_, clientName) => {
      this.addonValues[clientName] = {};
      this.savedAddonValues[clientName] = {};
    });

    // Load per-meeting add-ons
    for (const meetingName of this.selectedMeetings) {
      try {
        const addons = await this.http
          .get<any[]>(`${this.apiUrl}/reports/addon/${encodeURIComponent(meetingName)}`)
          .toPromise();
        (addons || []).forEach(a => {
          if (a.clientName && a.stake != null) {
            if (!this.addonValues[a.clientName]) this.addonValues[a.clientName] = {};
            if (!this.savedAddonValues[a.clientName]) this.savedAddonValues[a.clientName] = {};
            this.addonValues[a.clientName][meetingName] = a.stake;
            this.savedAddonValues[a.clientName][meetingName] = a.stake;
            // Detect clients with add-ons but no bets
            if (!this.groupedItems.has(a.clientName) && !this.manualAddonClients.includes(a.clientName)) {
              this.manualAddonClients.push(a.clientName);
            }
          }
        });
      } catch (e) {
        console.error(`Error loading add-ons for ${meetingName}:`, e);
      }
    }
    // Set default meeting for the add-client bar
    if (!this.newAddonMeeting || !this.selectedMeetings.includes(this.newAddonMeeting)) {
      this.newAddonMeeting = this.selectedMeetings[0] || '';
    }
  }

  addManualAddonClient() {
    const name = this.newAddonClientName.trim().toUpperCase();
    if (!name) return;
    
    const meeting = this.newAddonMeeting || this.selectedMeetings[0];
    if (!meeting) {
      alert('Please select a meeting');
      return;
    }
    
    const value = Number(this.newAddonValue ?? 0);
    
    // If client doesn't have bets, add to manual addon list
    if (!this.groupedItems.has(name) && !this.manualAddonClients.includes(name)) {
      this.manualAddonClients.push(name);
    }
    
    if (!this.addonValues[name]) this.addonValues[name] = {};
    if (!this.savedAddonValues[name]) this.savedAddonValues[name] = {};
    
    this.addonValues[name][meeting] = value;
    this.savedAddonValues[name][meeting] = value;
    
    this.http.post(`${this.apiUrl}/reports/addon`, { meetingName: meeting, clientName: name, stake: value })
      .subscribe({ error: (e) => console.error('Error saving add-on:', e) });
    
    this.newAddonClientName = '';
    this.newAddonValue = 0;
    this.cdr.detectChanges();
  }

  deleteManualAddonClient(clientName: string) {
    if (!confirm(`Delete Add-On for "${clientName}"?`)) return;
    this.manualAddonClients = this.manualAddonClients.filter(c => c !== clientName);
    delete this.addonValues[clientName];
    delete this.savedAddonValues[clientName];
    // Delete from DB for all selected meetings
    this.selectedMeetings.forEach(meetingName => {
      this.http.delete(`${this.apiUrl}/reports/addon/${encodeURIComponent(meetingName)}/${encodeURIComponent(clientName)}`)
        .subscribe({ error: (e) => console.error('Error deleting add-on:', e) });
    });
    this.cdr.detectChanges();
  }

  deleteAddon(clientName: string, meetingName: string) {
    if (!confirm(`Delete Add-On for "${clientName}" in meeting "${meetingName}"?`)) return;
    if (this.addonValues[clientName]) {
      delete this.addonValues[clientName][meetingName];
    }
    if (this.savedAddonValues[clientName]) {
      delete this.savedAddonValues[clientName][meetingName];
    }
    this.http.delete(`${this.apiUrl}/reports/addon/${encodeURIComponent(meetingName)}/${encodeURIComponent(clientName)}`)
      .subscribe({ error: (e) => console.error('Error deleting add-on:', e) });
    this.cdr.detectChanges();
  }

  getAdjustedPLForGroup(bets: any[], clientName: string): number {
    const addonTotal = this.selectedMeetings.reduce(
      (sum, m) => sum + Number(this.savedAddonValues[clientName]?.[m] || 0), 0
    );
    return this.getProfitLossForGroup(bets) + addonTotal;
  }

  getAdjustedPLForGroupByMeeting(bets: any[], clientName: string, meetingName: string): number {
    return this.getProfitLossForGroupByMeeting(bets, meetingName)
      + Number(this.savedAddonValues[clientName]?.[meetingName] || 0);
  }

  isHorseSpecial(param: any): boolean {
    const specialDate = this.specialDates.get(`${param.meetingName}-${param.raceNum}-${param.horseNum}`);
    return specialDate != null;
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
    
    // Sort bets by date within each client group
    this.groupedItems.forEach((bets, clientName) => {
      bets.sort((a, b) => b.date.getTime() - a.date.getTime());
    });
  }

  get filteredGroupedItems() {
    if (!this.filterClientName?.trim()) {
      return this.groupedItems;
    }
    
    const filtered = new Map<string, any[]>();
    const searchTerm = this.filterClientName.trim().toLowerCase();
    
    this.groupedItems.forEach((bets, clientName) => {
      if (clientName.toLowerCase().includes(searchTerm)) {
        filtered.set(clientName, bets);
      }
    });
    
    return filtered;
  }

  getFilteredGroupedItemsArray() {
    const items = this.filteredGroupedItems;
    const array = Array.from(items.entries()).map(([key, value]) => ({ key, value }));
    return array.sort((a, b) => a.key.localeCompare(b.key));
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

  getProfitLossForGroupByMeeting(bets: any[], meetingName: string): number {
    let totalStake = 0;
    let totalPayout = 0;
    let totalTax = 0;
    
    bets.forEach(bet => {
      if (bet.cancelled || this.shouldIgnoreBet(bet) || bet.meetingName !== meetingName) return;
      
      const stake = bet.stake || 0;
      totalStake += stake;
      
      const taxAmount = ((bet.tax || 0) / 100) * stake;
      totalTax += taxAmount;
      
      // Calculate payout with rule4 deductions (only for winners)
      if (this.isWinner(bet)) {
        let payout = bet.payout || 0;
        const betTime = new Date(bet.betTime || bet.createdAt);
        const raceKey = `${bet.meetingName}-${bet.raceNum}`;
        const rule4s = this.rule4Info.get(raceKey) || [];
        
        rule4s.forEach(r4 => {
          if (betTime < r4.date) {
            payout = payout * (1 - r4.deduct / 100);
          }
        });
        
        // Adjust for dead heat
        const winnerCount = this.allParams.filter(p => 
          p.meetingName === bet.meetingName && 
          p.raceNum === bet.raceNum && 
          p.winner &&
          !this.isHorseSpecial(p)
        ).length;
        if (winnerCount > 1) {
          payout = payout / winnerCount;
        }
        
        totalPayout += payout;
      }
    });
    
    return (totalStake + totalTax) - totalPayout;
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
        const raceKey = `${bet.meetingName}-${bet.raceNum}`;
        const rule4s = this.rule4Info.get(raceKey) || [];
        
        rule4s.forEach(r4 => {
          if (betTime < r4.date) {
            payout = payout * (1 - r4.deduct / 100);
          }
        });
        
        // Adjust for dead heat
        const winnerCount = this.allParams.filter(p => 
          p.meetingName === bet.meetingName && 
          p.raceNum === bet.raceNum && 
          p.winner &&
          !this.isHorseSpecial(p)
        ).length;
        if (winnerCount > 1) {
          payout = payout / winnerCount;
        }
        
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
      const bets = this.groupedItems.get(clientName) || [];
      if (this.getAdjustedPLForGroup(bets, clientName) > 0) total += report.totalTax;
    });
    return total;
  }

  getNetTotalProfitLoss(): number {
    let total = 0;
    this.groupedItems.forEach((bets, clientName) => {
      const adj = this.getAdjustedPLForGroup(bets, clientName);
      if (adj >= 0) total += adj;
    });
    this.manualAddonClients.forEach(clientName => {
      const adj = this.getAdjustedPLForGroup([], clientName);
      if (adj >= 0) total += adj;
    });
    return total;
  }

  getNetTotalTaxAmountLoss(): number {
    let total = 0;
    this.clientReports.forEach((report, clientName) => {
      const bets = this.groupedItems.get(clientName) || [];
      if (this.getAdjustedPLForGroup(bets, clientName) < 0) total += report.totalTax;
    });
    return total;
  }

  getNetTotalLoss(): number {
    let total = 0;
    this.groupedItems.forEach((bets, clientName) => {
      const adj = this.getAdjustedPLForGroup(bets, clientName);
      if (adj < 0) total += adj;
    });
    this.manualAddonClients.forEach(clientName => {
      const adj = this.getAdjustedPLForGroup([], clientName);
      if (adj < 0) total += adj;
    });
    return total;
  }

  getNetTotalProfitLossByMeeting(meetingName: string): number {
    let total = 0;
    this.groupedItems.forEach((bets, clientName) => {
      if (this.getAdjustedPLForGroup(bets, clientName) >= 0) {
        total += this.getAdjustedPLForGroupByMeeting(bets, clientName, meetingName);
      }
    });
    return total;
  }

  getNetTotalProfitLossByMeetingRaw(meetingName: string): number {
    let total = 0;
    this.groupedItems.forEach((bets, clientName) => {
      if (this.getAdjustedPLForGroup(bets, clientName) >= 0) {
        total += this.getProfitLossForGroupByMeeting(bets, meetingName);
      }
    });
    // Also include manual addon clients that have positive total
    this.manualAddonClients.forEach(clientName => {
      if (this.getAdjustedPLForGroup([], clientName) >= 0) {
        total += Number(this.savedAddonValues[clientName]?.[meetingName] || 0);
      }
    });
    return total;
  }

  getNetTotalLossByMeeting(meetingName: string): number {
    let total = 0;
    this.groupedItems.forEach((bets, clientName) => {
      if (this.getAdjustedPLForGroup(bets, clientName) < 0) {
        total += this.getAdjustedPLForGroupByMeeting(bets, clientName, meetingName);
      }
    });
    return total;
  }

  getNetTotalLossByMeetingRaw(meetingName: string): number {
    let total = 0;
    this.groupedItems.forEach((bets, clientName) => {
      if (this.getAdjustedPLForGroup(bets, clientName) < 0) {
        total += this.getProfitLossForGroupByMeeting(bets, meetingName);
      }
    });
    // Also include manual addon clients that have negative total
    this.manualAddonClients.forEach(clientName => {
      if (this.getAdjustedPLForGroup([], clientName) < 0) {
        total += Number(this.savedAddonValues[clientName]?.[meetingName] || 0);
      }
    });
    return total;
  }

  Math = Math;

  compareKeysAsc = (a: any, b: any) => {
    return a.key.localeCompare(b.key);
  };

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
    return this.allParams.some(p => {
      if (p.meetingName !== bet.meetingName || p.raceNum !== bet.raceNum) return false;
      const key = `${p.meetingName}-${p.raceNum}-${p.horseNum}`;
      const specialDate = this.specialDates.get(key);
      // If this horse was withdrawn and bet was before withdrawal, mark as special
      return specialDate && betTime < specialDate;
    });
  }

  isRule4(bet: any): boolean {
    // Check if the specific horse has rule4 flag set
    return this.allParams.some(p => 
      p.meetingName === bet.meetingName &&
      p.raceNum === bet.raceNum && 
      p.horseNum === bet.horseNum && 
      p.rule4 != null
    );
  }

  isWinner(bet: any): boolean {
    return this.allParams.some(p => 
      p.meetingName === bet.meetingName &&
      p.raceNum === bet.raceNum && 
      p.horseNum === bet.horseNum && 
      p.winner
    );
  }

  getDividedPayout(bet: any): number {
    let payout = bet.payout || 0;
    const betTime = new Date(bet.betTime || bet.createdAt);
    const raceKey = `${bet.meetingName}-${bet.raceNum}`;
    const rule4s = this.rule4Info.get(raceKey) || [];
    
    rule4s.forEach(r4 => {
      if (betTime < r4.date) {
        payout = payout * (1 - r4.deduct / 100);
      }
    });
    
    return payout;
  }

  hasRule4Deduction(bet: any): boolean {
    const betTime = new Date(bet.betTime || bet.createdAt);
    const raceKey = `${bet.meetingName}-${bet.raceNum}`;
    const rule4s = this.rule4Info.get(raceKey) || [];
    
    return rule4s.some(r4 => betTime < r4.date);
  }

  getRule4Deductions(bet: any): string {
    const betTime = new Date(bet.betTime || bet.createdAt);
    const raceKey = `${bet.meetingName}-${bet.raceNum}`;
    const rule4s = this.rule4Info.get(raceKey) || [];
    
    const deductions = rule4s
      .filter(r4 => betTime < r4.date)
      .map(r4 => `${r4.deduct}%`);
    
    return deductions.length > 0 ? `(${deductions.join(' ')})` : '';
  }

  hasActiveBets(bets: any[]): boolean {
    return bets.some(bet => !bet.cancelled && !this.shouldIgnoreBet(bet));
  }

  isFirstVisibleBet(bets: any[], currentBet: any): boolean {
    const firstNonCancelled = bets.find(bet => !bet.cancelled);
    return firstNonCancelled === currentBet;
  }

  getWinnerCountForRace(bet: any): number {
    // Only count winners that are not special (withdrawn)
    return this.allParams.filter(p => {
      if (p.meetingName !== bet.meetingName || p.raceNum !== bet.raceNum || !p.winner) return false;
      // Exclude if horse was made special (withdrawn)
      return !this.isHorseSpecial(p);
    }).length;
  }

  isDeadHeat(bet: any): boolean {
    return this.getWinnerCountForRace(bet) > 1;
  }

  getAdjustedPayout(bet: any): number {
    let payout = this.getDividedPayout(bet);
    const winnerCount = this.getWinnerCountForRace(bet);
    
    if (winnerCount > 1) {
      payout = payout / winnerCount;
    }
    
    return payout;
  }

  getHorseName(bet: any): string {
    const horseNames = this.horseNamesByRace.get(bet.meetingName);
    if (!horseNames) return '-';
    const raceIndex = bet.raceNum - 1;
    const horseIndex = bet.horseNum - 1;
    return horseNames[raceIndex]?.[horseIndex] || '-';
  }

  printProfit() {
    window.print();
  }
}
