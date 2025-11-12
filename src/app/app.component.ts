import { Component, OnInit, OnDestroy } from '@angular/core';
import { MarketService, AppData } from './shared/market.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Games';
  toolbarColor: string = '';
  marketType: number; // Will be loaded from localStorage
  
  // Store app data to ensure it's loaded
  appData: AppData | null = null;
  backendConnected: boolean = false;
  
  private subscription: Subscription = new Subscription();

  constructor(private marketService: MarketService) {
    // Load the saved market type from localStorage (via the service)
    this.marketType = this.marketService.getCurrentMarketType();
    console.log('📍 Restored market type from localStorage:', this.marketType);
  }

  ngOnInit(): void {
    // Subscribe to app data to ensure it's loaded and available
    this.subscription.add(
      this.marketService.appData$.subscribe(data => {
        this.appData = data;
        console.log('App component loaded with data:', data);
      })
    );

    // Subscribe to market type changes to keep UI in sync and load data
    this.subscription.add(
      this.marketService.marketType$.subscribe(type => {
        const previousMarketType = this.marketType;
        this.marketType = type;
        // Update toolbar color based on market type
        this.toolbarColor = type === 0 ? 'black' : 'pink';
        
        // Load data from backend when market type changes (but not on initial load)
        if (previousMarketType !== undefined && previousMarketType !== type) {
          console.log(`🔄 Market type changed from ${previousMarketType} to ${type} - loading database...`);
          this.loadFromBackend();
        }
      })
    );

    // Load any existing data from localStorage first
    this.appData = this.marketService.getCurrentAppData();
    console.log('Initial app data from localStorage:', this.appData);

    // Load data from backend database on app startup
    this.loadFromBackend();
  }

  // Load data from backend when app starts
  loadFromBackend(): void {
    console.log('🔄 Loading data from backend...');
    
    // Load data for the current market type
    const currentMarketType = this.marketService.getCurrentMarketType();
    const marketName = currentMarketType === 0 ? 'Local' : 'International';
    
    this.marketService.loadFromBackend(currentMarketType).subscribe({
      next: (response) => {
        console.log(`✅ ${marketName} data loaded from backend:`, response);
        this.backendConnected = true;
        
        // Check if backend has data
        if (response && (response.numEvents || response.events?.length > 0)) {
          // Update service with backend data
          this.marketService.updateFromBackendResponse(response);
          console.log(`✅ App initialized with ${marketName} backend data`);
        } else {
          console.log(`ℹ️ No ${marketName} data in backend, using localStorage data`);
        }
      },
      error: (error) => {
        console.warn('⚠️ Could not connect to backend:', error.message);
        console.log('ℹ️ Using localStorage data. Backend server may not be running.');
        console.log('💡 To start backend: cd backend && npm start');
        this.backendConnected = false;
        // Continue with localStorage data - app will still work
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  setLocalMode() { //setting marketType to local and changing toolbar color to black
    this.toolbarColor = 'black';
    this.marketType = 0;
    this.marketService.setMarketType(0);
    
    // Load Local data from backend when switching
    this.loadFromBackend();
  }

  setInternationalMode() { //setting marketType to international and changing toolbar color to pink
    this.toolbarColor = 'pink';
    this.marketType = 1;
    this.marketService.setMarketType(1);
    
    // Load International data from backend when switching
    this.loadFromBackend();
  }

  clearCurrentMarketData() {
    const marketName = this.marketType === 0 ? 'Local' : 'International';
    if (confirm(`Are you sure you want to clear all ${marketName} race data?`)) {
      this.marketService.clearAllData();
      console.log(`${marketName} data cleared by user`);
    }
  }

  clearAllMarketsData() {
    if (confirm('Are you sure you want to clear ALL race data (Local AND International)?')) {
      this.marketService.clearAllMarketData();
      console.log('All market data cleared by user');
    }
  }
}
