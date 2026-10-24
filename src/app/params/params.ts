import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
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

type TimeField = 'special' | 'rule4';

@Component({
  selector: 'app-params',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './params.html',
  styleUrl: './params.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Params implements OnInit {
  private apiUrl = `${environment.apiUrl}/api`;

  dataSource: ParamRow[] = [];
  raceGroups: { [key: number]: ParamRow[] } = {};
  raceNumbers: number[] = [];
  meetingName: string = '';
  loading: boolean = true;
  private existingParams: any[] = [];

  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly openRows = signal<ReadonlySet<number>>(new Set());
  protected readonly lastSavedAt = signal<Date | null>(null);
  protected readonly statusText = computed(() => {
    if (this.saving()) return 'Saving...';
    if (this.dirty()) return 'Unsaved changes';
    const saved = this.lastSavedAt();
    return saved ? `Saved at ${this.formatClock(saved)}` : '';
  });

  private meetingData = inject(MeetingDataService);
  private offlineStore = inject(OfflineStoreService);
  private snackBar = inject(MatSnackBar);
  private http = inject(HttpClient);
  private cdr = inject(ChangeDetectorRef);

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
        this.cdr.detectChanges();
        return;
      }

      this.meetingName = this.meetingData.getMeetingName();

      const params = await this.meetingData.getParams();
      this.existingParams = params;
      this.buildDataSource(races, params);
      this.dirty.set(false);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error loading data:', error);
      this.notify('Error loading races. Please check if the backend is running.');
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

  getRaceData(raceNum: number): ParamRow[] {
    return this.raceGroups[raceNum] || [];
  }

  countNamed(raceNum: number): number {
    return this.getRaceData(raceNum).filter(row => !!row.horseName?.trim()).length;
  }

  scrollToRace(raceNum: number) {
    document.getElementById(`race-${raceNum}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The withdrawal fields are shown for a horse that already has a time, or when opened by hand
  isOpen(row: ParamRow): boolean {
    return !!row.special || !!row.rule4 || this.openRows().has(row.rowIndex);
  }

  toggleRow(row: ParamRow) {
    this.openRows.update(open => {
      const next = new Set(open);
      if (next.has(row.rowIndex)) {
        next.delete(row.rowIndex);
      } else {
        next.add(row.rowIndex);
      }
      return next;
    });
  }

  markDirty() {
    this.dirty.set(true);
  }

  private buildRows() {
    return this.dataSource.map(row => ({
      meetingName: row.meetingName,
      raceNum: row.raceNum,
      horseNum: row.horseNum,
      horseName: row.horseName,
      special: row.special,
      rule4: row.rule4,
      rule4deduct: row.rule4deduct
    }));
  }

  // Rule 4 horses whose deduction % is missing: other horses' payouts would not be reduced
  private rule4WithoutDeduction(): ParamRow[] {
    return this.dataSource.filter(row => !!row.rule4 && !(row.rule4deduct && row.rule4deduct > 0));
  }

  saveParams() {
    const latestUpdatedAt = this.existingParams
      .map(p => p.updatedAt ? new Date(p.updatedAt).getTime() : 0)
      .filter(Boolean)
      .reduce((max, t) => t > max ? t : max, 0);

    const syncBaseUpdatedAt = latestUpdatedAt > 0 ? new Date(latestUpdatedAt).toISOString() : null;

    const data = {
      params: this.buildRows(),
      clientRequestId: this.offlineStore.generateRequestId(),
      syncBaseUpdatedAt: syncBaseUpdatedAt
    };

    const missing = this.rule4WithoutDeduction();
    const warning = missing.length > 0
      ? ` Check Rule 4 deduction %: ${missing.map(r => `R${r.raceNum} #${r.horseNum}`).join(', ')}`
      : '';

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.offlineStore.queueParams(data).then(() => {
        this.meetingData.invalidateParams();
        this.dirty.set(false);
        this.notify('Saved offline. Will sync when online.' + warning);
      });
      return;
    }

    this.saving.set(true);
    this.http.post(`${this.apiUrl}/params`, data).subscribe({
      next: (response: any) => {
        this.meetingData.invalidateParams();
        this.saving.set(false);
        this.dirty.set(false);
        this.lastSavedAt.set(new Date());
        this.notify('Parameters saved.' + warning);
        // Refresh existingParams so the next save uses up-to-date updatedAt timestamps
        if (response?.params) {
          this.existingParams = response.params;
        }
      },
      error: (error) => {
        console.error('Error saving params:', error);
        this.saving.set(false);
        this.notify('Error saving parameters. Please try again.');
      }
    });
  }

  onHorseNameEnter(event: Event, currentIndex: number) {
    event.preventDefault();

    // Auto-save current data
    this.autoSave();

    // Move to next horse name field
    const nextIndex = currentIndex + 1;
    if (nextIndex < this.dataSource.length) {
      setTimeout(() => {
        const nextInput = document.getElementById(`horseName-${nextIndex}`) as HTMLInputElement | null;
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }, 50);
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

    const data = { params: this.buildRows() };

    this.http.post(`${this.apiUrl}/params`, data).subscribe({
      next: (response: any) => {
        this.meetingData.invalidateParams();
        this.dirty.set(false);
        this.lastSavedAt.set(new Date());
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

  // Value for <input type="datetime-local">, in the user's local time
  toInputValue(date: Date | null): string {
    if (!date) return '';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  onDateTimeChange(row: ParamRow, field: TimeField, value: string | null) {
    const date = value ? new Date(value) : null;
    row[field] = date && !Number.isNaN(date.getTime()) ? date : null;
    if (field === 'rule4' && !row.rule4) {
      row.rule4deduct = null;
    }
    this.markDirty();
  }

  setNow(row: ParamRow, field: TimeField) {
    const now = new Date();
    now.setSeconds(0, 0);
    row[field] = now;
    this.markDirty();
  }

  clearDateTime(row: ParamRow, field: TimeField) {
    row[field] = null;
    if (field === 'rule4') {
      row.rule4deduct = null;
    }
    this.markDirty();
  }

  onDeductChange(row: ParamRow, value: number | null) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      row.rule4deduct = null;
    } else {
      row.rule4deduct = Math.min(100, Math.max(0, Number(value)));
    }
    this.markDirty();
  }

  private notify(message: string) {
    this.snackBar.open(message, 'OK', { duration: 5000 });
  }

  private formatClock(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
