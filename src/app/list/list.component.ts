import { Component, OnInit } from '@angular/core';
import { MarketService } from '../shared/market.service';

@Component({
  selector: 'app-list',
  templateUrl: './list.component.html',
  styleUrls: ['./list.component.css']
})
export class ListComponent implements OnInit {
  betTransactions: any[] = [];
  filteredTransactions: any[] = [];
  isLoading: boolean = false;
  displayedColumns: string[] = [
    'timestamp',
    'marketType',
    'raceNum',
    'horseNum',
    'horseName',
    'clientName',
    'transactionType',
    'books',
    'stake',
    'f500',
    'odds100',
    'payout',
    'tax'
  ];

  // Filters
  searchText: string = '';
  filterRaceNum: number | null = null;
  filterHorseNum: number | null = null;
  filterTransactionType: string = 'all';

  constructor(private marketService: MarketService) { }

  ngOnInit(): void {
    this.loadAllBets();
  }

  loadAllBets(): void {
    this.isLoading = true;
    this.marketService.getBetTransactions().subscribe({
      next: (transactions) => {
        this.betTransactions = transactions;
        this.filteredTransactions = [...transactions];
        this.isLoading = false;
        console.log('📊 Loaded all bet transactions:', transactions.length);
      },
      error: (error) => {
        console.error('❌ Error loading bet transactions:', error);
        this.isLoading = false;
      }
    });
  }

  applyFilters(): void {
    this.filteredTransactions = this.betTransactions.filter(transaction => {
      // Search text filter (client name only)
      const searchMatch = !this.searchText || 
        transaction.clientName?.toLowerCase().includes(this.searchText.toLowerCase());

      // Race number filter
      const raceMatch = !this.filterRaceNum || 
        transaction.raceNum === this.filterRaceNum;

      // Horse number filter
      const horseMatch = !this.filterHorseNum || 
        transaction.horseNum === this.filterHorseNum;

      // Transaction type filter
      const transactionMatch = this.filterTransactionType === 'all' || 
        transaction.transactionType === this.filterTransactionType;

      return searchMatch && raceMatch && horseMatch && transactionMatch;
    });
  }

  getTotalPayout(): number {
    const activeTransactions = this.filteredTransactions.filter(t => t.cancel !== 1);
    return activeTransactions.reduce((sum, t) => sum + (t.payout || 0), 0);
  }

  getTotalStake(): number {
    const activeTransactions = this.filteredTransactions.filter(t => t.cancel !== 1);
    return activeTransactions.reduce((sum, t) => sum + (t.stake || 0), 0);
  }

  formatDate(timestamp: string): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  cancelTransaction(transaction: any): void {
    const isCancelled = transaction.cancel === 1;
    const action = isCancelled ? 'uncancel' : 'cancel';
    
    // Toggle the cancel status
    const newCancelStatus = isCancelled ? 0 : 1;
    const oldCancelStatus = transaction.cancel;
    transaction.cancel = newCancelStatus;
    
    // Update in backend
    this.marketService.updateBetTransaction(transaction).subscribe({
      next: (response: any) => {
        console.log(`✅ Transaction ${action}led successfully:`, response);
      },
      error: (error: any) => {
        console.error(`❌ Error ${action}ling transaction:`, error);
        alert(`Failed to ${action} transaction. Please try again.`);
        // Revert the change on error
        transaction.cancel = oldCancelStatus;
      }
    });
  }
}
