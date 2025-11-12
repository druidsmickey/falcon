import { Component, OnInit, OnDestroy } from '@angular/core';
import { MarketService, AppData } from '../shared/market.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-events',
  templateUrl: './events.component.html',
  styleUrls: ['./events.component.css']
})
export class EventsComponent implements OnInit, OnDestroy {
  marketType: number = 0; // Default to local
  marketTypeName: string = 'Local';
  numEvents: number | null = null; // Allow null for clearing
  events: any[] = []; // Specify array type to avoid conflict with DOM Event
  selectedEventId: number | null = null;
  
  // Structure to hold event data
  eventData: any = {};
  
  // Database operation states
  isSaving: boolean = false;
  isLoading: boolean = false;
  statusMessage: string = '';
  statusClass: string = '';
  
  private subscription: Subscription = new Subscription();

  constructor(private marketService: MarketService) { 
    console.log('EventsComponent constructor called');
    // Get the current market type immediately
    this.marketType = this.marketService.getCurrentMarketType();
    this.marketTypeName = this.marketService.getMarketTypeName();
    
    // Load existing app data
    this.loadAppData();
    console.log('Initial data loaded - numEvents:', this.numEvents, 'events:', this.events);
  }

  ngOnInit(): void {
    // Subscribe to market type changes only
    // When market type changes, reload data for that market
    this.subscription.add(
      this.marketService.marketType$.subscribe(type => {
        console.log('Market type changed to:', type);
        const previousMarketType = this.marketType;
        this.marketType = type;
        this.marketTypeName = this.marketService.getMarketTypeName();
        
        // Only reload data if market type actually changed (not initial load)
        if (previousMarketType !== type) {
          console.log('Market type switched - loading new data');
          this.loadAppData();
        }
      })
    );

    // Don't subscribe to appData$ to avoid interference with user input
    // The component will push changes to service, not pull from it
  }

  // Load existing app data from service
  loadAppData() {
    const appData = this.marketService.getCurrentAppData();
    console.log('Loading app data from service:', appData);
    this.numEvents = appData.numEvents;
    this.events = appData.events;
    this.selectedEventId = appData.selectedEventId;
    this.eventData = appData.eventData;
    console.log('Component data after loading:', {
      numEvents: this.numEvents,
      events: this.events,
      selectedEventId: this.selectedEventId
    });
  }

  // Handle input event as backup
  onNumEventsInput(event: any) {
    console.log('onNumEventsInput called with value:', event.target.value);
    const value = parseInt(event.target.value, 10);
    if (!isNaN(value)) {
      this.numEvents = value;
      this.generateEvents();
    } else if (event.target.value === '') {
      this.numEvents = null;
      this.generateEvents();
    }
  }

  // Generate events based on numEvents input
  generateEvents() {
    console.log('=== generateEvents called ===');
    console.log('Current numEvents value:', this.numEvents);
    console.log('Type of numEvents:', typeof this.numEvents);
    
    if (this.numEvents && this.numEvents > 0) {
      this.events = [];
      for (let i = 1; i <= this.numEvents; i++) {
        this.events.push({
          id: i,
          name: `${i}`
        });
      }
      console.log('Generated events array:', this.events);
    } else {
      this.events = [];
      this.selectedEventId = null;
      this.eventData = {};
      console.log('Cleared events because numEvents is:', this.numEvents);
    }
    
    // Save to service
    console.log('Saving to service...');
    this.marketService.setNumEvents(this.numEvents);
    this.marketService.setEvents(this.events);
    this.marketService.setSelectedEventId(this.selectedEventId);
    this.marketService.setEventData(this.eventData);
    console.log('=== generateEvents completed ===');
  }

  // Handle event selection
  onEventSelect(eventId: number) {
    console.log('Event selected:', eventId);
    this.selectedEventId = eventId;
    
    // Initialize event data if not exists
    if (!this.eventData[eventId]) {
      this.eventData[eventId] = {
        marketName: `Race ${eventId}`, // Set default market name to race number
        numMarketList: null,
        marketLists: []
      };
      console.log('Initialized event data for event', eventId, this.eventData[eventId]);
    } else {
      console.log('Event data already exists for event', eventId, this.eventData[eventId]);
    }
    
    // Save to service
    this.marketService.setSelectedEventId(this.selectedEventId);
    this.marketService.setEventData(this.eventData);
  }

  // Generate market lists for selected event
  generateMarketLists(eventId: number) {
    console.log('generateMarketLists called with eventId:', eventId);
    const event = this.eventData[eventId];
    console.log('Event data:', event);
    
    if (event && event.numMarketList && event.numMarketList > 0) {
      // Initialize marketLists if it doesn't exist
      if (!event.marketLists) {
        event.marketLists = [];
      }
      
      const currentLength = event.marketLists.length;
      const targetLength = event.numMarketList;
      
      if (targetLength > currentLength) {
        // Add new entries, preserving existing ones
        
        for (let i = currentLength + 1; i <= targetLength; i++) {
          event.marketLists.push({
            id: i,
            name: '',
            odds100: 0,
            special: '',  // Initialize as empty (will show "Not set")
            rule4: '',    // Initialize as empty (will show "Not set")
            rule4Deduction: 0
          });
        }
        console.log(`Added ${targetLength - currentLength} new horse entries`);
      } else if (targetLength < currentLength) {
        // Remove excess entries from the end
        event.marketLists = event.marketLists.slice(0, targetLength);
        console.log(`Removed ${currentLength - targetLength} horse entries`);
      }
      
      console.log('Updated market lists:', event.marketLists);
    } else if (event) {
      event.marketLists = [];
      console.log('Cleared market lists');
    }
  }

  // Handle market list count change
  onMarketListCountChange(value: number) {
    if (this.selectedEventId && this.eventData[this.selectedEventId]) {
      this.eventData[this.selectedEventId].numMarketList = value;
      this.generateMarketLists(this.selectedEventId);
      // Save to service
      this.marketService.setEventData(this.eventData);
    }
  }

  // Get market name for binding
  getMarketName(): string {
    if (this.selectedEventId && this.eventData[this.selectedEventId]) {
      // If market name is empty, return the race number as default
      if (!this.eventData[this.selectedEventId].marketName) {
        return `${this.selectedEventId}`;
      }
      return this.eventData[this.selectedEventId].marketName;
    }
    return '';
  }

  // Set market name for binding
  setMarketName(value: string) {
    if (this.selectedEventId && this.eventData[this.selectedEventId]) {
      this.eventData[this.selectedEventId].marketName = value;
      // Save to service
      this.marketService.setEventData(this.eventData);
    }
  }

  // Get num market list for binding
  getNumMarketList(): number | null {
    return this.selectedEventId && this.eventData[this.selectedEventId] 
      ? this.eventData[this.selectedEventId].numMarketList 
      : null;
  }

  // Save event data to service (called when horse names or other data changes)
  saveEventData(): void {
    console.log('Saving event data to service...');
    this.marketService.setEventData(this.eventData);
    console.log('Event data saved:', this.eventData);
  }

  // Save all data to backend database
  saveToDatabase(): void {
    this.isSaving = true;
    this.statusMessage = 'Saving to database...';
    this.statusClass = 'status-info';

    this.marketService.saveToBackend().subscribe({
      next: (response) => {
        console.log('Save to database successful:', response);
        this.isSaving = false;
        this.statusMessage = `✅ Data saved successfully to ${this.marketTypeName} database!`;
        this.statusClass = 'status-success';
        
        // Clear message after 5 seconds
        setTimeout(() => {
          this.statusMessage = '';
        }, 5000);
      },
      error: (error) => {
        console.error('Error saving to database:', error);
        this.isSaving = false;
        this.statusMessage = `❌ Error saving to database. Make sure the backend server is running on http://localhost:3000`;
        this.statusClass = 'status-error';
        
        // Clear message after 10 seconds
        setTimeout(() => {
          this.statusMessage = '';
        }, 10000);
      }
    });
  }

  // Load data from backend database
  loadFromDatabase(): void {
    this.isLoading = true;
    this.statusMessage = 'Loading from database...';
    this.statusClass = 'status-info';

    this.marketService.loadFromBackend().subscribe({
      next: (response) => {
        console.log('Load from database successful:', response);
        
        // Update local component state
        this.numEvents = response.numEvents;
        this.events = response.events || [];
        this.selectedEventId = response.selectedEventId;
        this.eventData = response.eventData || {};
        
        // Update service
        this.marketService.updateFromBackendResponse(response);
        
        this.isLoading = false;
        this.statusMessage = `✅ Data loaded successfully from ${this.marketTypeName} database!`;
        this.statusClass = 'status-success';
        
        // Clear message after 5 seconds
        setTimeout(() => {
          this.statusMessage = '';
        }, 5000);
      },
      error: (error) => {
        console.error('Error loading from database:', error);
        this.isLoading = false;
        this.statusMessage = `❌ Error loading from database. Make sure the backend server is running on http://localhost:3000`;
        this.statusClass = 'status-error';
        
        // Clear message after 10 seconds
        setTimeout(() => {
          this.statusMessage = '';
        }, 10000);
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }
}
