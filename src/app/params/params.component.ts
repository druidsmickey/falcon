import { Component, OnInit, OnDestroy } from '@angular/core';
import { MarketService, AppData } from '../shared/market.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-params',
  templateUrl: './params.component.html',
  styleUrls: ['./params.component.css']
})
export class ParamsComponent implements OnInit, OnDestroy {
  marketType: number = 0;
  marketTypeName: string = 'Local';
  appData: AppData = {
    numEvents: null,
    events: [],
    selectedEventId: null,
    eventData: {}
  };
  
  // Columns to display in mat-table
  displayedColumns: string[] = ['id', 'name', 'special', 'rule4', 'rule4Deduction'];
  
  // Track which events are in edit mode
  editingEventIds: Set<number> = new Set();
  
  // Store original data before editing (for cancel functionality if needed)
  originalEventData: { [key: number]: any } = {};
  
  private subscription: Subscription = new Subscription();

  constructor(private marketService: MarketService) {
    // Get current data immediately
    this.marketType = this.marketService.getCurrentMarketType();
    this.marketTypeName = this.marketService.getMarketTypeName();
    this.appData = this.marketService.getCurrentAppData();
  }

  ngOnInit(): void {
    // Subscribe to market type changes
    this.subscription.add(
      this.marketService.marketType$.subscribe(type => {
        this.marketType = type;
        this.marketTypeName = this.marketService.getMarketTypeName();
      })
    );

    // Subscribe to app data changes
    this.subscription.add(
      this.marketService.appData$.subscribe(data => {
        this.appData = data;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  // Check if an event is in edit mode
  isEditing(eventId: number): boolean {
    return this.editingEventIds.has(eventId);
  }

  // Toggle edit mode for an event
  toggleEdit(eventId: number): void {
    if (this.isEditing(eventId)) {
      // Currently editing, so this is a "Save" action
      this.saveChanges(eventId);
    } else {
      // Start editing
      this.startEdit(eventId);
    }
  }

  // Start editing an event
  startEdit(eventId: number): void {
    // Store original data in case we need to cancel
    this.originalEventData[eventId] = JSON.parse(JSON.stringify(this.appData.eventData[eventId]));
    this.editingEventIds.add(eventId);
    console.log(`Started editing event ${eventId}`);
  }

  // Save changes to the database
  saveChanges(eventId: number): void {
    console.log(`Saving changes for event ${eventId}`);
    console.log('Data to save:', this.appData.eventData[eventId]);
    
    // Update the service with current data
    this.marketService.updateEventData(eventId, this.appData.eventData[eventId]);
    
    // Save to backend
    this.marketService.saveToBackend().subscribe({
      next: (response) => {
        console.log('✅ Changes saved to backend:', response);
        alert('✅ Successfully saved to database!');
        // Exit edit mode
        this.editingEventIds.delete(eventId);
        delete this.originalEventData[eventId];
      },
      error: (error) => {
        console.error('❌ Error saving to backend:', error);
        console.error('Error details:', error.message, error.status, error.statusText);
        alert(`Failed to save to database. Changes saved locally.\n\nError: ${error.message || 'Backend not responding'}`);
        // Still exit edit mode even if backend fails (data is in localStorage)
        this.editingEventIds.delete(eventId);
        delete this.originalEventData[eventId];
      }
    });
  }

  // Get button text based on edit state
  getButtonText(eventId: number): string {
    return this.isEditing(eventId) ? 'Save' : 'Modify';
  }

  // Format datetime string for display
  formatDateTime(dateTimeString: string): string {
    if (!dateTimeString || dateTimeString === '') {
      return 'Not set';
    }
    
    try {
      const date = new Date(dateTimeString);
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      
      // Format: "Oct 23, 2025 2:30 PM"
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (e) {
      return 'Invalid date';
    }
  }

  // Track changes for input fields
  onHorseFieldChange(eventId: number, horseIndex: number, field: string, value: any): void {
    if (!this.appData.eventData[eventId] || !this.appData.eventData[eventId].marketLists[horseIndex]) {
      return;
    }
    
    const horse = this.appData.eventData[eventId].marketLists[horseIndex];
    
    // Update the specific field
    if (field === 'name') {
      horse.name = value;
    } else if (field === 'special') {
      horse.special = value || '';  // Store as date string
    } else if (field === 'rule4') {
      horse.rule4 = value || '';    // Store as date string
    } else if (field === 'rule4Deduction') {
      horse.rule4Deduction = Number(value) || 0;
    }
  }
}
