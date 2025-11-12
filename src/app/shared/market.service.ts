import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';

export interface EventData {
  marketName: string;
  numMarketList: number | null;
  marketLists: Array<{ 
    id: number; 
    name: string;
    odds100: number;
    special: string;  // Changed to string for date
    rule4: string;    // Changed to string for date
    rule4Deduction: number;
  }>;
}

export interface AppData {
  numEvents: number | null;
  events: Array<{ id: number; name: string }>;
  selectedEventId: number | null;
  eventData: { [key: number]: EventData };
}

@Injectable({
  providedIn: 'root'
})

export class MarketService {
  private readonly LOCAL_STORAGE_KEY = 'gamesAppData_Local';
  private readonly INTERNATIONAL_STORAGE_KEY = 'gamesAppData_International';
  private readonly MARKET_TYPE_KEY = 'marketType';
  // Use localhost for desktop, use IP address for phone access
  private readonly API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3000/api'
    : `http://${window.location.hostname}:3000/api`;
  
  private marketTypeSubject = new BehaviorSubject<number>(this.loadMarketType());
  public marketType$ = this.marketTypeSubject.asObservable();

  // Add events data management
  private appDataSubject = new BehaviorSubject<AppData>(this.loadAppDataForCurrentMarket());
  public appData$ = this.appDataSubject.asObservable();

  constructor(private http: HttpClient) { 
    console.log('MarketService initialized');
    console.log('Current market type:', this.getCurrentMarketType());
    console.log('Loaded data:', this.loadAppDataForCurrentMarket());
  }

  // Get storage key based on market type
  private getStorageKey(): string {
    const marketType = this.getCurrentMarketType();
    return marketType === 0 ? this.LOCAL_STORAGE_KEY : this.INTERNATIONAL_STORAGE_KEY;
  }

  // Load market type from localStorage
  private loadMarketType(): number {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(this.MARKET_TYPE_KEY);
      return stored ? parseInt(stored, 10) : 1; // Default to international
    }
    return 1;
  }

  // Save market type to localStorage
  private saveMarketType(type: number): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.MARKET_TYPE_KEY, type.toString());
    }
  }

  // Load app data for current market type
  private loadAppDataForCurrentMarket(): AppData {
    const storageKey = this.getStorageKey();
    const marketName = this.getMarketTypeName();
    
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        try {
          const data = JSON.parse(stored);
          console.log(`📂 Loaded ${marketName} data from ${storageKey}:`, data);
          return data;
        } catch (e) {
          console.error('Error parsing stored app data:', e);
        }
      } else {
        console.log(`📂 No ${marketName} data found in ${storageKey}, returning empty data`);
      }
    }
    // Return default data structure
    return {
      numEvents: null,
      events: [],
      selectedEventId: null,
      eventData: {}
    };
  }

  // Save app data to localStorage for current market type
  private saveAppData(data: AppData): void {
    const storageKey = this.getStorageKey();
    const marketName = this.getMarketTypeName();
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(storageKey, JSON.stringify(data));
        console.log(`💾 ${marketName} data saved to ${storageKey}:`, data);
      } catch (e) {
        console.error('Error saving app data to localStorage:', e);
      }
    }
  }

  setMarketType(type: number) {
    const oldType = this.getCurrentMarketType();
    console.log(`Switching market type from ${oldType} to ${type}`);
    
    // Only switch if actually changing
    if (oldType === type) {
      console.log('Already on this market type');
      return;
    }
    
    // Update market type first
    this.marketTypeSubject.next(type);
    this.saveMarketType(type);
    
    // Load data for the new market type (uses updated market type)
    const newData = this.loadAppDataForCurrentMarket();
    this.appDataSubject.next(newData);
    
    console.log(`✅ Switched to ${type === 0 ? 'Local' : 'International'} market`);
    console.log(`Loaded data:`, newData);
  }

  getCurrentMarketType(): number {
    return this.marketTypeSubject.value;
  }

  getMarketTypeName(): string {
    return this.marketTypeSubject.value === 0 ? 'Local' : 'International';
  }

  // Events data management methods
  updateAppData(data: Partial<AppData>) {
    const currentData = this.appDataSubject.value;
    const updatedData = { ...currentData, ...data };
    const marketType = this.getCurrentMarketType();
    const marketName = this.getMarketTypeName();
    
    console.log(`📝 Updating ${marketName} data:`, data);
    
    this.appDataSubject.next(updatedData);
    this.saveAppData(updatedData);
    
    console.log(`✅ ${marketName} data saved to localStorage`);
  }

  getCurrentAppData(): AppData {
    return this.appDataSubject.value;
  }

  setNumEvents(numEvents: number | null) {
    this.updateAppData({ numEvents });
  }

  setEvents(events: Array<{ id: number; name: string }>) {
    this.updateAppData({ events });
  }

  setSelectedEventId(selectedEventId: number | null) {
    this.updateAppData({ selectedEventId });
  }

  setEventData(eventData: { [key: number]: EventData }) {
    this.updateAppData({ eventData });
  }

  updateEventData(eventId: number, data: Partial<EventData>) {
    const currentAppData = this.getCurrentAppData();
    const updatedEventData = {
      ...currentAppData.eventData,
      [eventId]: { ...currentAppData.eventData[eventId], ...data }
    };
    this.updateAppData({ eventData: updatedEventData });
  }

  // Clear app data for current market type only
  clearAllData(): void {
    const defaultData: AppData = {
      numEvents: null,
      events: [],
      selectedEventId: null,
      eventData: {}
    };
    this.appDataSubject.next(defaultData);
    this.saveAppData(defaultData);
    const marketName = this.getMarketTypeName();
    console.log(`${marketName} app data cleared`);
  }

  // Clear data for both Local and International
  clearAllMarketData(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.LOCAL_STORAGE_KEY);
      localStorage.removeItem(this.INTERNATIONAL_STORAGE_KEY);
      console.log('All market data (Local and International) cleared');
    }
    this.clearAllData();
  }

  // Check if there is any saved data for current market type
  hasExistingData(): boolean {
    const data = this.getCurrentAppData();
    return data.numEvents !== null || 
           data.events.length > 0 || 
           Object.keys(data.eventData).length > 0;
  }

  // ==================== Backend API Methods ====================

  // Save current app data to backend server
  saveToBackend(): Observable<any> {
    const appData = this.getCurrentAppData();
    const marketType = this.getCurrentMarketType();
    
    const payload = {
      marketType: marketType,
      numEvents: appData.numEvents,
      events: appData.events,
      selectedEventId: appData.selectedEventId,
      eventData: appData.eventData
    };

    console.log('Saving to backend:', payload);
    return this.http.post(`${this.API_URL}/appdata`, payload);
  }

  // Load app data from backend server
  loadFromBackend(marketType?: number): Observable<any> {
    const type = marketType !== undefined ? marketType : this.getCurrentMarketType();
    console.log('Loading from backend for market type:', type);
    return this.http.get(`${this.API_URL}/appdata?marketType=${type}`);
  }

  // Get all historical data from backend
  getHistoryFromBackend(): Observable<any> {
    return this.http.get(`${this.API_URL}/appdata/history/all`);
  }

  // Clear backend data for specific market type
  clearBackendData(marketType?: number): Observable<any> {
    const type = marketType !== undefined ? marketType : this.getCurrentMarketType();
    return this.http.delete(`${this.API_URL}/appdata/clear/${type}`);
  }

  // Clear all backend data (both markets)
  clearAllBackendData(): Observable<any> {
    return this.http.delete(`${this.API_URL}/appdata/clear/all`);
  }

  // Update appData from backend response
  updateFromBackendResponse(data: any): void {
    const appData: AppData = {
      numEvents: data.numEvents,
      events: data.events,
      selectedEventId: data.selectedEventId,
      eventData: data.eventData
    };
    this.appDataSubject.next(appData);
    this.saveAppData(appData);
    console.log('Data updated from backend:', appData);
  }

  // ==================== Bet Transaction Methods ====================

  // Save a bet transaction to backend
  saveBetTransaction(transaction: any): Observable<any> {
    console.log('💰 Saving bet transaction to backend:', transaction);
    return this.http.post(`${this.API_URL}/bet-transaction`, transaction);
  }

  // Update a bet transaction (e.g., for cancellation)
  updateBetTransaction(transaction: any): Observable<any> {
    console.log('📝 Updating bet transaction:', transaction);
    return this.http.put(`${this.API_URL}/bet-transaction/${transaction._id}`, transaction);
  }

  // Get bet transactions for current market type
  getBetTransactions(raceNum?: number): Observable<any> {
    const marketType = this.getCurrentMarketType();
    let url = `${this.API_URL}/bet-transactions?marketType=${marketType}`;
    if (raceNum !== undefined) {
      url += `&raceNum=${raceNum}`;
    }
    return this.http.get(url);
  }

  // Get recent client names with their last bet details
  getRecentClients(limit: number = 7): Observable<any> {
    const marketType = this.getCurrentMarketType();
    return this.http.get(`${this.API_URL}/recent-clients?marketType=${marketType}&limit=${limit}`);
  }
}
