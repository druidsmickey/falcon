import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { environment } from '../../environments/environment';
import { MeetingDataService } from '../services/meeting-data.service';
import { OfflineStoreService } from '../services/offline-store.service';

interface ParamRow {
  meetingName: string;
  raceNum: number;
  horseNum: number;
  rowIndex: number;
  horseName: string;
  special: Date | null;
  rule4: Date | null;
  rule4deduct: number | null;
}

@Component({
  selector: 'app-params',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatInputModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './params.html',
  styleUrl: './params.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Params implements OnInit {
  private apiUrl = `${environment.apiUrl}/api`;
  
  displayedColumns: string[] = ['raceNum', 'horseNum', 'horseName', 'special', 'rule4', 'rule4deduct'];
  dataSource: ParamRow[] = [];
  raceGroups: { [key: number]: ParamRow[] } = {};
  raceNumbers: number[] = [];
  meetingName: string = '';
  loading: boolean = true;
  private existingParams: any[] = [];

  private meetingData = inject(MeetingDataService);
  private offlineStore = inject(OfflineStoreService);

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.loading = true;
    this.dataSource = [];
    this.raceGroups = {};
    this.raceNumbers = [];
    this.cdr.detectChanges();

    // Let the loader paint before starting fetch/build work
    await new Promise(resolve => setTimeout(resolve, 0));

    try {
      const races = await this.meetingData.getSelectedRaces();
      if (races.length === 0) {
        this.loading = false;
        alert('No selected races found. Please select a meeting in the Init page first.');
        this.cdr.detectChanges();
        return;
      }

      this.meetingName = this.meetingData.getMeetingName();

      const params = await this.meetingData.getParams();
      this.existingParams = params;
      this.buildDataSource(races, params);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Error loading races. Please check if the backend is running.');
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  buildDataSource(races: any[], existingParams: any[]) {
    this.dataSource = [];
    this.raceGroups = {};
    this.raceNumbers = [];

    // Build O(1) lookup map for existing params
    const paramMap = new Map<string, any>();
    existingParams.forEach(p => paramMap.set(`${p.raceNum}-${p.horseNum}`, p));

    let rowIndex = 0;

    races.forEach(race => {
      const raceNum = race.raceNum;
      const numHorses = race.numHorse;
      
      this.raceGroups[raceNum] = [];

      for (let horseNum = 1; horseNum <= numHorses; horseNum++) {
        // O(1) lookup instead of .find()
        const existingParam = paramMap.get(`${raceNum}-${horseNum}`);

        const row: ParamRow = {
          meetingName: races[0].meetingName,
          raceNum: raceNum,
          horseNum: horseNum,
          rowIndex,
          horseName: existingParam?.horseName || '',
          special: existingParam?.special ? new Date(existingParam.special) : null,
          rule4: existingParam?.rule4 ? new Date(existingParam.rule4) : null,
          rule4deduct: existingParam?.rule4deduct || null
        };

        this.dataSource.push(row);
        this.raceGroups[raceNum].push(row);
        rowIndex += 1;
      }
    });

    this.raceNumbers = Object.keys(this.raceGroups).map(Number).sort((a, b) => a - b);
  }

  getRaceNumbers(): number[] {
    return this.raceNumbers;
  }

  getRaceData(raceNum: number): ParamRow[] {
    return this.raceGroups[raceNum] || [];
  }

  saveParams() {
    const latestUpdatedAt = this.existingParams
      .map(p => p.updatedAt ? new Date(p.updatedAt).getTime() : 0)
      .filter(Boolean)
      .reduce((max, t) => t > max ? t : max, 0);

    const syncBaseUpdatedAt = latestUpdatedAt > 0 ? new Date(latestUpdatedAt).toISOString() : null;

    const data = {
      params: this.dataSource.map(row => ({
        meetingName: row.meetingName,
        raceNum: row.raceNum,
        horseNum: row.horseNum,
        horseName: row.horseName,
        special: row.special,
        rule4: row.rule4,
        rule4deduct: row.rule4deduct
      })),
      clientRequestId: this.offlineStore.generateRequestId(),
      syncBaseUpdatedAt: syncBaseUpdatedAt
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.offlineStore.queueParams(data).then(() => {
        this.meetingData.invalidateParams();
        alert('Parameters saved offline. Will sync when online.');
      });
      return;
    }

    this.http.post(`${this.apiUrl}/params`, data).subscribe({
      next: (response: any) => {
        this.meetingData.invalidateParams();
        alert('Parameters saved successfully!');
        // Refresh existingParams so the next save uses up-to-date updatedAt timestamps
        if (response?.params) {
          this.existingParams = response.params;
        }
      },
      error: (error) => {
        console.error('Error saving params:', error);
        alert('Error saving parameters. Please try again.');
      }
    });
  }

  onHorseNameKeydown(event: KeyboardEvent, currentIndex: number) {
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      
      // Auto-save current data
      this.autoSave();
      
      // Move to next horse name field
      const nextIndex = currentIndex + 1;
      if (nextIndex < this.dataSource.length) {
        setTimeout(() => {
          const nextInput = document.getElementById(`horseName-${nextIndex}`);
          if (nextInput) {
            nextInput.focus();
            (nextInput as HTMLInputElement).select();
          }
        }, 50);
      }
    }
  }

  onHorseNameInput(row: ParamRow) {
    if (row.horseName) {
      row.horseName = row.horseName.toUpperCase();
    }
  }

  autoSave() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    const data = {
      params: this.dataSource.map(row => ({
        meetingName: row.meetingName,
        raceNum: row.raceNum,
        horseNum: row.horseNum,
        horseName: row.horseName,
        special: row.special,
        rule4: row.rule4,
        rule4deduct: row.rule4deduct
      }))
    };

    this.http.post(`${this.apiUrl}/params`, data).subscribe({
      next: (response: any) => {
        this.meetingData.invalidateParams();
        console.log('Auto-saved successfully');
        // Keep existingParams in sync so subsequent manual saves don't get a 409
        if (response?.params) {
          this.existingParams = response.params;
        }
      },
      error: (error) => {
        console.error('Error auto-saving params:', error);
      }
    });
  }

  getTimeString(date: Date | null): string {
    if (!date) return '';
    const d = new Date(date);
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  setTime(row: ParamRow, field: 'special' | 'rule4', timeString: string) {
    if (!timeString) return;
    
    const [hours, minutes] = timeString.split(':').map(Number);
    
    // If no date is set, create a new date with today's date
    if (!row[field]) {
      row[field] = new Date();
    }
    
    // Update the time on the existing date
    const date = new Date(row[field]!);
    date.setHours(hours, minutes, 0, 0);
    row[field] = date;
  }

  clearDateTime(row: ParamRow, field: 'special' | 'rule4') {
    row[field] = null;
    if (field === 'rule4') {
      row.rule4deduct = null;
    }
    this.cdr.detectChanges();
  }
}
