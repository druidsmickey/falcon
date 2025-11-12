import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { MarketService, AppData } from '../shared/market.service';

@Component({
  selector: 'app-betslip',
  templateUrl: './betslip.component.html',
  styleUrls: ['./betslip.component.css']
})
export class BetslipComponent implements OnInit {
  appData: AppData = {
    numEvents: null,
    events: [],
    selectedEventId: null,
    eventData: {}
  };
  
  selectedRaceId: number | null = null;
  selectedHorse: any = null;
  betTransactions: any[] = [];
  showSavedMessage: boolean = false;
  betAmount: number = 0;
  tax: number = 5;
  useF500: boolean = true;
  isSales: boolean = true;
  hasTax: boolean = true;
  clientName: string = '';
  remarks: string = '';
  recentClients: any[] = [];
  races: Array<{ id: number; name: string }> = [];
  selectedRaceHorses: any[] = [];
  currentPayout: number = 0;

  constructor(
    private marketService: MarketService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    // Subscribe to app data changes
    this.marketService.appData$.subscribe(data => {
      this.appData = data;
      this.races = data.events || [];
      console.log('Betslip component loaded data:', data);
    });

    // Subscribe to market type changes
    this.marketService.marketType$.subscribe(type => {
      console.log('🔄 Market type changed in betslip');
      this.loadLastTransaction();
      this.loadRecentClients();
    });
    
    // Load initial data
    this.loadLastTransaction();
    this.loadRecentClients();
  }

  // Get races/events as an array
  getRaces(): Array<{ id: number; name: string }> {
    return this.races;
  }

  // Get horses for selected race
  getHorsesForRace(raceId: number): any[] {
    const eventData = this.appData.eventData[raceId];
    if (eventData && eventData.marketLists) {
      return eventData.marketLists;
    }
    return [];
  }

  // Get currently selected race horses
  getSelectedRaceHorses(): any[] {
    return this.selectedRaceHorses;
  }

  // Handle horse selection change in dropdown
  onHorseChange(): void {
    console.log('Horse changed to:', this.selectedHorse);
    this.updatePayout();
  }
  
  // Update payout value
  updatePayout(): void {
    this.currentPayout = this.calculatePayoutInternal();
  }
  
  // Internal calculation method
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

  // Handle race selection change
  onRaceChange(): void {
    console.log('Race changed to:', this.selectedRaceId);
    if (this.selectedRaceId !== null) {
      const horses = this.getHorsesForRace(this.selectedRaceId);
      this.selectedRaceHorses = [...horses];
      this.selectedHorse = null;
      this.updatePayout();
    }
  }

  // Handle tax checkbox change
  onTaxChange(): void {
    this.tax = this.hasTax ? 5 : 0;
  }
  
  // Handle bet amount change
  onBetAmountChange(): void {
    this.updatePayout();
  }
  
  // Handle checkbox changes that affect payout
  onBetTypeChange(): void {
    this.updatePayout();
  }

  // Save horse data
  saveHorse(): void {
    if (!this.selectedHorse || !this.selectedRaceId) {
      alert('Please select a race and horse first');
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
      transaction.books = effectiveBetAmount;
      transaction.stake = effectiveBetAmount*this.selectedHorse.odds100;
      transaction.f500 = this.selectedHorse.odds100;
      transaction.odds100 = null;
      transaction.payout = effectiveBetAmount * 500;
    } else {
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
        
        // Show saved message
        this.showSavedMessage = true;
        setTimeout(() => {
          this.showSavedMessage = false;
        }, 10000);
        
        // Update the last transaction display
        this.loadLastTransaction();
        
        // Reset form
        this.resetForm();
      },
      error: (error) => {
        console.error('❌ Error saving bet transaction:', error);
        alert('Failed to save bet transaction. Please try again.');
      }
    });
  }

  // Reset form
  resetForm(): void {
    this.selectedHorse = null;
    this.betAmount = 0;
    this.clientName = '';
    this.tax = 5;
    this.hasTax = true;
    this.currentPayout = 0;
  }

  // Public getter for template
  calculatePayout(): number {
    return this.currentPayout;
  }

  // Load last transaction
  loadLastTransaction(): void {
    this.marketService.getBetTransactions().subscribe({
      next: (transactions) => {
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
    this.useF500 = client.lastBetType === 'f500';
    this.tax = client.lastTax || 0;
    this.hasTax = this.tax > 0;

  }
}
