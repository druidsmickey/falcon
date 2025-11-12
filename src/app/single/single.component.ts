import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { MarketService, AppData, EventData } from '../shared/market.service';

@Component({
  selector: 'app-single',
  templateUrl: './single.component.html',
  styleUrls: ['./single.component.css']
})
export class SingleComponent implements OnInit {
  appData: AppData = {
    numEvents: null,
    events: [],
    selectedEventId: null,
    eventData: {}
  };
  
  selectedRaceId: number | null = null;
  selectedHorse: any = null;
  sidebarOpen: boolean = false;
  displayedColumns: string[] = ['id', 'name', 'books', 'profitLoss', 'avg'];
  betTransactions: any[] = [];
  allRaceTransactions: { [raceId: number]: any[] } = {}; // Cache all transactions by race
  horseDataSource = new MatTableDataSource<any>([]); // Material table data source
  showSavedMessage: boolean = false; // Flag to show saved message
  betAmount: number = 0;
  tax: number = 5;
  useF500: boolean = true;
  isSales: boolean = true;
  hasTax: boolean = true;
  clientName: string = '';
  remarks: string = '';
  recentClients: any[] = []; // Store recent client names with their last bet info
  races: Array<{ id: number; name: string }> = []; // Cached races array
  selectedRaceHorses: any[] = []; // Cached horses for selected race
  currentPayout: number = 0; // Cached payout value
  totalAvg: number = 0; // Total average for the race

  constructor(
    private marketService: MarketService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    // Subscribe to app data changes
    this.marketService.appData$.subscribe(data => {
      this.appData = data;
      this.races = data.events || []; // Cache races array
      console.log('Single component loaded data:', data);
      
      // Restore last selected race if available
      this.restoreLastSelectedRace();
    });

    // Subscribe to market type changes to clear cached bet transactions
    this.marketService.marketType$.subscribe(type => {
      console.log('🔄 Market type changed, clearing bet transaction cache');
      // Clear the cached bet transactions when market changes
      this.allRaceTransactions = {};
      // Reload transactions for current race if one is selected
      if (this.selectedRaceId !== null) {
        this.loadBetTransactionsForRace();
      }
      // Reload last transaction
      this.loadLastTransaction();
      // Reload recent clients for new market
      this.loadRecentClients();
    });
    
    // Load recent clients on init
    this.loadRecentClients();
  }

  // Save selected race to localStorage
  private saveSelectedRace(): void {
    if (this.selectedRaceId !== null) {
      const marketType = this.marketService.getCurrentMarketType();
      const storageKey = `selectedRace_${marketType}`;
      localStorage.setItem(storageKey, this.selectedRaceId.toString());
    }
  }

  // Restore last selected race from localStorage
  private restoreLastSelectedRace(): void {
    const marketType = this.marketService.getCurrentMarketType();
    const storageKey = `selectedRace_${marketType}`;
    const savedRaceId = localStorage.getItem(storageKey);
    
    if (savedRaceId && this.appData.events.length > 0) {
      const raceId = parseInt(savedRaceId, 10);
      // Verify the race still exists in current data
      const raceExists = this.appData.events.some(event => event.id === raceId);
      if (raceExists) {
        this.selectedRaceId = raceId;
        console.log(`🔄 Restored last selected race: ${raceId}`);
      }
    }
  }

  // Get races/events as an array (now returns cached value)
  getRaces(): Array<{ id: number; name: string }> {
    return this.races;
  }

  // Select a race to view its horses
  selectRace(raceId: number): void {
    this.selectedRaceId = raceId;
    this.saveSelectedRace();
    this.updateHorseDataSource();
    this.loadBetTransactionsForRace();
    this.updatePayout(); // Update payout when race changes
  }

  // Update the horse data source for the table
  updateHorseDataSource(): void {
    if (this.selectedRaceId !== null) {
      const horses = this.getHorsesForRace(this.selectedRaceId);
      this.horseDataSource.data = [...horses]; // Update data property
      this.selectedRaceHorses = [...horses]; // Cache selected race horses
      this.cdr.detectChanges(); // Force change detection
    } else {
      this.horseDataSource.data = [];
      this.selectedRaceHorses = [];
    }
  }

  // Check if a race is selected
  isRaceSelected(raceId: number): boolean {
    return this.selectedRaceId === raceId;
  }

  // Get horses for selected race (full objects)
  getHorsesForRace(raceId: number): any[] {
    const eventData = this.appData.eventData[raceId];
    if (eventData && eventData.marketLists) {
      return eventData.marketLists;
    }
    return [];
  }

  // Get currently selected race horses (full objects) - now returns cached value
  getSelectedRaceHorses(): any[] {
    return this.selectedRaceHorses;
  }

  // Handle horse selection change in dropdown
  onHorseChange(): void {
    console.log('Horse changed to:', this.selectedHorse);
    this.updatePayout(); // Recalculate payout when horse changes
  }
  
  // Update payout value (caches the calculation result)
  updatePayout(): void {
    this.currentPayout = this.calculatePayoutInternal();
  }
  
  // Internal calculation method (not called from template)
  private calculatePayoutInternal(): number {
    if (this.selectedHorse && this.selectedHorse.odds100 && this.betAmount) {
      const effectiveBetAmount = this.isSales ? this.betAmount : -this.betAmount;
      
      if (this.useF500) {
        return (effectiveBetAmount * 500);
      } else {
        return (effectiveBetAmount * this.selectedHorse.odds100) / 100;
      }
    }
    return 0;
  }

  // Handle race selection change in sidebar
  onRaceChangeInSidebar(): void {
    console.log('Race changed to:', this.selectedRaceId);
    if (this.selectedRaceId !== null) {
      this.saveSelectedRace();
      this.updateHorseDataSource();
      this.loadBetTransactionsForRace();
      
      // Reset selected horse since we changed races
      this.selectedHorse = null;
      this.updatePayout();
    }
  }

  // Handle tax checkbox change
  onTaxChange(): void {
    this.tax = this.hasTax ? 5 : 0;
  }
  
  // Handle bet amount change (call this from template with ngModelChange)
  onBetAmountChange(): void {
    this.updatePayout();
  }
  
  // Handle checkbox changes that affect payout
  onBetTypeChange(): void {
    this.updatePayout();
  }

  // Open sidebar with horse details
  openHorseSidebar(horseId: number): void {
    if (this.selectedRaceId !== null) {
      const eventData = this.appData.eventData[this.selectedRaceId];
      if (eventData && eventData.marketLists) {
        const horse = eventData.marketLists.find(h => h.id === horseId);
        if (horse) {
          this.selectedHorse = horse;
          this.sidebarOpen = true;
          this.updatePayout();
        }
      }
    }
  }

  // Close sidebar
  closeSidebar(): void {
    this.sidebarOpen = false;
    this.selectedHorse = null;
    this.betAmount = 0;
    this.clientName = '';
    this.remarks = '';
    this.tax = 5;
    this.hasTax = true;
    this.currentPayout = 0;
  }

  // Save horse data
  saveHorse(): void {
    if (!this.selectedHorse || !this.selectedRaceId) {
      alert('Please select a horse first');
      return;
    }

    if (!this.clientName.trim()) {
      alert('Please enter client name');
      return;
    }

    if (this.betAmount <= 0) {
      alert('Please enter a valid bet amount');
      return;
    }

    // Validate F500/Odds value
    const oddsValue = Math.floor(this.selectedHorse.odds100); // Remove decimals
    if (this.useF500) {
      if (oddsValue < 1 || oddsValue > 460) {
        alert('F500 value must be between 1 and 460 (no decimals)');
        return;
      }
    } else {
      if (oddsValue < 110 || oddsValue > 9000) {
        alert('Odds value must be between 110 and 9000 (no decimals)');
        return;
      }
    }

    // Update the odds value to remove decimals
    this.selectedHorse.odds100 = oddsValue;

    const marketType = this.marketService.getCurrentMarketType();
    const transactionType = this.isSales ? 'Sales' : 'Purchases';
    const effectiveBetAmount = this.isSales ? this.betAmount : -this.betAmount;
    
    let transaction: any = {
      marketType: marketType,
      raceNum: this.selectedRaceId,
      horseNum: this.selectedHorse.id,
      horseName: this.selectedHorse.name,
      clientName: this.clientName.trim().toUpperCase(),
      transactionType: transactionType,
      isF500: this.useF500,
      tax: this.tax || 0,
      cancel: 0,
      rule4: 0,
      special: 0,
      remarks: "",
      timestamp: new Date().toISOString()
    };

    if (this.useF500) {
      // F500 mode: books and F500
      transaction.books = effectiveBetAmount;
      transaction.stake = effectiveBetAmount*this.selectedHorse.odds100;
      transaction.f500 = this.selectedHorse.odds100;
      transaction.odds100 = null;
      transaction.payout = effectiveBetAmount * 500;
    } else {
      // Odds100 mode: stake and odds100
      transaction.stake = effectiveBetAmount;
      transaction.odds100 = this.selectedHorse.odds100;
      transaction.books = null;
      transaction.f500 = null;
      transaction.payout = (effectiveBetAmount * this.selectedHorse.odds100) / 100;
    }

    console.log('📝 Saving bet transaction:', transaction);

    // Save to backend
    this.marketService.saveBetTransaction(transaction).subscribe({
      next: (response) => {
        console.log('✅ Bet transaction saved successfully:', response);
        console.log('📝 Original transaction object:', transaction);
        
        // Show saved message
        this.showSavedMessage = true;
        setTimeout(() => {
          this.showSavedMessage = false;
        }, 10000); // Hide after 10 seconds
        
        // Update cached data instead of refetching
        if (this.selectedRaceId !== null) {
          // Add the new transaction to cache - use transaction object with all calculated fields
          if (!this.allRaceTransactions[this.selectedRaceId]) {
            this.allRaceTransactions[this.selectedRaceId] = [];
          }
          // Use the transaction object we created, not the response
          this.allRaceTransactions[this.selectedRaceId].push(transaction);
          
          console.log('💾 Updated cache:', this.allRaceTransactions[this.selectedRaceId]);
          
          // Recalculate profit/loss with updated cache
          this.calculateProfitLossForRace(this.selectedRaceId, this.allRaceTransactions[this.selectedRaceId]);
          
          // Update the last transaction display
          this.loadLastTransaction();
        }
        
        this.closeSidebar();
      },
      error: (error) => {
        console.error('❌ Error saving bet transaction:', error);
        alert('Failed to save bet transaction. Please try again.');
      }
    });
  }

  // Public getter for template (returns cached value)
  calculatePayout(): number {
    return this.currentPayout;
  }

  // Load bet transactions for the race and calculate profit/loss
  loadBetTransactionsForRace(): void {
    if (this.selectedRaceId !== null) {
      // Check if we already have cached data for this race
      if (this.allRaceTransactions[this.selectedRaceId]) {
        console.log('📦 Using cached transactions for race', this.selectedRaceId);
        this.calculateProfitLossForRace(this.selectedRaceId, this.allRaceTransactions[this.selectedRaceId]);
        this.loadLastTransaction();
        return;
      }

      // Fetch from backend if not cached
      this.marketService.getBetTransactions(this.selectedRaceId).subscribe({
        next: (raceTransactions: any[]) => {
          // Cache the transactions
          this.allRaceTransactions[this.selectedRaceId!] = raceTransactions;
          
          this.calculateProfitLossForRace(this.selectedRaceId!, raceTransactions);
          
          // Also load the last transaction for display
          this.loadLastTransaction();
        },
        error: (error: any) => {
          console.error('❌ Error loading bet transactions:', error);
          this.loadLastTransaction();
        }
      });
    } else {
      this.loadLastTransaction();
    }
  }

  // Calculate profit/loss for a specific race
  calculateProfitLossForRace(raceId: number, raceTransactions: any[]): void {
    // Filter out cancelled transactions
    const activeTransactions = raceTransactions.filter((t: any) => t.cancel !== 1);
    
    // Get horses directly from eventData to ensure we're updating the same objects
    const eventData = this.appData.eventData[raceId];
    if (!eventData || !eventData.marketLists) {
      console.warn('⚠️ No event data found for race', raceId);
      return;
    }
    
    // Filter transactions based on special date for each horse
    const validTransactions = activeTransactions.filter((t: any) => {
      const horse = eventData.marketLists.find((h: any) => h.id === t.horseNum);
      if (horse && horse.special) {
        const specialDate = new Date(horse.special);
        const betDate = new Date(t.timestamp);
        // Only include bets that are on or after the special date
        return betDate >= specialDate;
      }
      // If no special date, include the transaction
      return true;
    });
    
    // Calculate total stake and total payout for the race (excluding cancelled and before special date)
    const totalStake = validTransactions.reduce((sum: number, t: any) => sum + (t.stake || 0), 0);
    const totalPayout = validTransactions.reduce((sum: number, t: any) => sum + (t.payout || 0), 0);
    
    // Calculate profit/loss, books, and avg for each horse
    let sumOfAvg = 0;
    eventData.marketLists.forEach((horse: any) => {
      // Get total payout and total stake for this horse (excluding cancelled and before special date)
      const horseTransactions = validTransactions.filter((t: any) => t.horseNum === horse.id);
      const horsePayout = horseTransactions.reduce((sum: number, t: any) => sum + (t.payout || 0), 0);
      const horseStake = horseTransactions.reduce((sum: number, t: any) => sum + (t.stake || 0), 0);
      
      // Books = Total Payout / 500
      horse.books = Math.round(horsePayout / 500);
      
      // Profit/Loss = Total Stake - Horse Payout
      horse.profitLoss = totalStake - horsePayout;
      
      // Avg = 500 / (horsePayout / horseStake)
      if (horseStake !== 0 && horsePayout !== 0) {
        horse.avg = Math.round(500 / (horsePayout / horseStake));
      } else {
        horse.avg = 0;
      }
      
      // Add to sum for Total Avg
      sumOfAvg += horse.avg;
      
      console.log(`  Horse ${horse.id} (${horse.name}): Books = ${horse.books}, P/L = ${horse.profitLoss}, Avg = ${horse.avg}`);
    });
    
    // Calculate Total Avg = sum of all horse averages
    this.totalAvg = sumOfAvg;
    
    console.log('📊 Calculated profit/loss for race', raceId, '- Total stake:', totalStake, '- Total Avg:', this.totalAvg);
    
    // Update the data source to trigger table refresh
    this.updateHorseDataSource();
    
    // Force change detection
    this.cdr.detectChanges();
  }

  // Load just the last transaction for display
  loadLastTransaction(): void {
    this.marketService.getBetTransactions().subscribe({
      next: (transactions) => {
        // Get only the most recent transaction (first item since backend sorts by createdAt: -1)
        this.betTransactions = transactions.length > 0 ? [transactions[0]] : [];
        console.log('📊 Loaded last bet transaction:', this.betTransactions);
      },
      error: (error) => {
        console.error('❌ Error loading bet transactions:', error);
        this.betTransactions = [];
      }
    });
  }

  // Load recent clients from backend
  loadRecentClients(): void {
    this.marketService.getRecentClients(7).subscribe({
      next: (clients) => {
        this.recentClients = clients;
        console.log('👥 Loaded recent clients:', this.recentClients);
      },
      error: (error) => {
        console.error('❌ Error loading recent clients:', error);
        this.recentClients = [];
      }
    });
  }

  // Populate form with client's last bet details
  selectClient(client: any): void {
    console.log('👤 Selected client:', client);
    this.clientName = client.clientName;
    
    // Set the bet type (F500 or Odds)
    this.useF500 = client.lastBetType === 'f500';
     
    // Set the tax
    this.tax = client.lastTax || 0;
    this.hasTax = this.tax > 0;
    
    // do not call updatePayout here to avoid premature calculation
    // this.updatePayout(); 
  }

  // Format date for display
  formatDateTime(dateString: string): string {
    if (!dateString) return 'Not set';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric', 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  }
}
