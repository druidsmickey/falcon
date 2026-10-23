import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { environment } from '../../environments/environment';
import { MeetingDataService } from '../services/meeting-data.service';
import { OfflineStoreService } from '../services/offline-store.service';

interface Race {
  raceNum: number;
  raceName: string;
  numHorse: number;
}

@Component({
  selector: 'app-init',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule
  ],
  templateUrl: './init.html',
  styleUrl: './init.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Init implements OnInit {
  private apiUrl = `${environment.apiUrl}/api`;
  
  meetingNames: string[] = [];
  selectedMeeting: string = '';
  newMeetingName: string = '';
  isCreatingNew: boolean = false;
  totalRaces: number = 0;
  races: Race[] = [];
  isSelected: boolean = false;
  meetingCreatedAt: Date | null = null;

  private meetingData = inject(MeetingDataService);
  private offlineStore = inject(OfflineStoreService);

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  ngOnInit() {
    this.loadMeetingNames();
  }

  loadMeetingNames() {
    this.http.get<string[]>(`${this.apiUrl}/meetings`).subscribe({
      next: (meetings) => {
        this.meetingNames = meetings;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading meetings:', error);
      }
    });
  }

  onMeetingChange() {
    if (this.selectedMeeting && this.selectedMeeting !== 'new') {
      this.isCreatingNew = false;
      this.meetingCreatedAt = null;
      this.loadRaces(this.selectedMeeting);
    } else if (this.selectedMeeting === 'new') {
      this.isCreatingNew = true;
      this.totalRaces = 0;
      this.races = [];
      this.newMeetingName = '';
      this.meetingCreatedAt = null;
    }
  }

  loadRaces(meetingName: string) {
    this.http.get<any[]>(`${this.apiUrl}/meetings/${meetingName}/races`).subscribe({
      next: (races) => {
        this.races = races.map(r => ({
          raceNum: r.raceNum,
          raceName: r.raceName,
          numHorse: r.numHorse
   
        }));
        this.totalRaces = this.races.length;
        // Get the selected status from the first race (all races in the meeting share this value)
        this.isSelected = races.length > 0 && races[0].selected === true;
        // Use the max updatedAt across all races — this matches what the backend
        // conflict check compares against (Init.findOne().sort({ updatedAt: -1 }))
        const maxUpdatedAt = races.reduce((max: number, r: any) => {
          const t = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
          return t > max ? t : max;
        }, 0);
        this.meetingCreatedAt = maxUpdatedAt > 0 ? new Date(maxUpdatedAt) : null;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error loading races:', error);
      }
    });
  }

  onTotalRacesChange() {
    const currentLength = this.races.length;
    const newTotal = this.totalRaces || 0;

    if (newTotal > currentLength) {
      // Add new races
      for (let i = currentLength; i < newTotal; i++) {
        this.races.push({
          raceNum: i + 1,
          raceName: 'R' + (i + 1),
          numHorse: 0
        });
      }
    } else if (newTotal < currentLength) {
      // Remove excess races
      this.races = this.races.slice(0, newTotal);
    }
  }

  onMeetingNameInput() {
    if (this.newMeetingName) {
      this.newMeetingName = this.newMeetingName.toUpperCase();
    }
  }

  onRaceNameInput(race: Race) {
    if (race.raceName) {
      race.raceName = race.raceName.toUpperCase();
    }
  }

  saveRaces() {
    const meetingName = this.isCreatingNew ? this.newMeetingName : this.selectedMeeting;
    
    if (!meetingName || !meetingName.trim()) {
      alert('Please enter or select a meeting name');
      return;
    }

    if (this.races.length === 0) {
      alert('Please add at least one race');
      return;
    }

    // Validate all races
    for (let i = 0; i < this.races.length; i++) {
      const race = this.races[i];
      if (!race.raceName || !race.raceName.trim()) {
        alert(`Please enter a name for Race ${race.raceNum}`);
        return;
      }
      if (!race.numHorse || race.numHorse <= 0) {
        alert(`Please enter a valid number of horses for Race ${race.raceNum}`);
        return;
      }
    }

    const data = {
      meetingName: meetingName.trim(),
      races: this.races,
      selected: this.isSelected,
      clientRequestId: this.offlineStore.generateRequestId(),
      syncBaseUpdatedAt: this.meetingCreatedAt ? this.meetingCreatedAt.toISOString() : null
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.offlineStore.queueMeetingRaces(data).then(() => {
        this.meetingData.invalidateAll();
        alert('Races saved offline. Will sync when online.');
      });
      return;
    }

    this.http.post(`${this.apiUrl}/meetings/races`, data).subscribe({
      next: (response) => {
        this.meetingData.invalidateAll();
        alert('Races saved successfully!');
        if (this.isCreatingNew) {
          this.loadMeetingNames();
          this.selectedMeeting = meetingName;
          this.isCreatingNew = false;
        }
        // Always reload races to refresh meetingCreatedAt after save,
        // otherwise subsequent saves will get a 409 conflict.
        this.loadRaces(meetingName.trim());
      },
      error: (error) => {
        console.error('Error saving races:', error);
        console.error('Error details:', error.error);
        console.error('Status:', error.status);
        console.error('Full error object:', JSON.stringify(error));
        alert(`Error saving races: ${error.message || error.status || 'Unknown error'}. Check console for details.`);
      }
    });
  }

  deleteMeeting() {
    if (!this.selectedMeeting || this.isCreatingNew) {
      return;
    }

    const meetingToDelete = this.selectedMeeting;
    const confirmation = prompt(
      `âš ï¸ WARNING: This will permanently delete ALL data for meeting "${meetingToDelete}"!\n\n` +
      `This includes:\n` +
      `- All race configurations\n` +
      `- All parameters (winners, special, rule4)\n` +
      `- All bets\n\n` +
      `To confirm deletion, please type the exact meeting name: ${meetingToDelete}`
    );

    if (confirmation !== meetingToDelete) {
      if (confirmation !== null) {
        alert('Meeting name does not match. Deletion cancelled.');
      }
      return;
    }

    // Double confirmation
    const finalConfirm = confirm(
      `Are you absolutely sure you want to delete meeting "${meetingToDelete}"?\n\n` +
      `This action CANNOT be undone!`
    );

    if (!finalConfirm) {
      return;
    }

    this.http.delete(`${this.apiUrl}/meetings/${encodeURIComponent(meetingToDelete)}`).subscribe({
      next: (response: any) => {
        this.meetingData.invalidateAll();
        alert(
          `Meeting "${meetingToDelete}" has been deleted successfully!\n\n` +
          `Deleted:\n` +
          `- ${response.deleted.init} race configurations\n` +
          `- ${response.deleted.params} parameters\n` +
          `- ${response.deleted.bets} bets`
        );
        
        // Reset to create new meeting
        this.selectedMeeting = 'new';
        this.isCreatingNew = true;
        this.totalRaces = 0;
        this.races = [];
        this.newMeetingName = '';
        this.isSelected = false;
        
        // Reload meeting list
        this.loadMeetingNames();
        
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Error deleting meeting:', error);
        alert(`Error deleting meeting: ${error.message || 'Unknown error'}. Check console for details.`);
      }
    });
  }
}
