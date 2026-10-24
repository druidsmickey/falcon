import { Component, signal, inject, OnInit, OnDestroy, viewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import * as QRCode from 'qrcode';
import { environment } from '../../environments/environment';

interface Contact {
  id: string;
  name: string;
  number: string;
  createdAt: Date;
}

interface WhatsAppContact {
  name: string;
  number: string;
  isWhatsAppContact: boolean;
}

interface Group {
  id: string;
  name: string;
  contactIds: string[];
  contactCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface WhatsAppStatus {
  status: string;
  isReady: boolean;
  qrCode: string | null;
}

// What the WhatsApp routes answer (not every route sends every field)
interface WhatsAppResponse {
  success?: boolean;
  message?: string;
  error?: string;
  sentTo?: string;
  results: { success: boolean }[];
  group: { contactCount: number };
  notFoundCount?: number;
  browserVersion?: string;
  chromePath?: string;
  suggestion?: string;
}

interface SentMessage {
  id: string;
  message: string;
  sentAt: Date;
  contactCount: number;
}

@Component({
  selector: 'app-whatsapp',
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatIconModule,
    MatCheckboxModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatRadioModule,
    MatSelectModule,
    MatTooltipModule
  ],
  templateUrl: './whatsapp.html',
  styleUrl: './whatsapp.css',
})
export class Whatsapp implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;
  
  // The QR code is drawn here in the browser: the text that links a device to WhatsApp must not be
  // sent to an outside website.
  protected qrImage = signal('');
  private lastQrText: string | null = null;

  protected status = signal<WhatsAppStatus>({ status: 'disconnected', isReady: false, qrCode: null });
  protected contacts = signal<Contact[]>([]);
  protected selectedContacts = signal<Set<string>>(new Set());
  
  protected whatsappContacts = signal<WhatsAppContact[]>([]);
  protected selectedWhatsAppContacts = signal<Set<string>>(new Set());
  protected showImportDialog = signal(false);
  protected importLoading = signal(false);
  
  protected groups = signal<Group[]>([]);
  protected selectedGroup = signal<string | null>(null);
  protected newGroupName = signal('');
  protected selectedContactsForGroup = signal<Set<string>>(new Set());
  protected editingGroup = signal<Group | null>(null);
  
  protected newContactName = signal('');
  protected newContactNumber = signal('');
  protected message = signal('');
  
  protected sentMessages = signal<SentMessage[]>([]);
  protected selectedMessages = signal<Set<string>>(new Set());
  
  protected loading = signal(false);
  protected statusMessage = signal('');
  
  protected cameraInput = viewChild<ElementRef<HTMLInputElement>>('cameraInput');
  
  private statusCheckInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit() {
    this.loadContacts();
    this.loadGroups();
    this.loadSelectedGroup();
    this.checkStatus();
    this.startStatusPolling();
  }

  ngOnDestroy() {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
    }
  }

  private startStatusPolling() {
    this.statusCheckInterval = setInterval(() => {
      if (this.status().status !== 'ready') {
        this.checkStatus();
      }
    }, 3000);
  }

  protected checkStatus() {
    this.http.get<WhatsAppStatus>(`${this.apiUrl}/api/whatsapp/status`).subscribe({
      next: (status) => {
        this.status.set(status);
        this.updateQrImage(status.qrCode);
      },
      error: (error) => {
        console.error('Error checking status:', error);
      }
    });
  }

  protected initializeWhatsApp() {
    this.loading.set(true);
    this.statusMessage.set('Initializing WhatsApp client...');
    
    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/initialize`, {}).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set(response.message ?? '');
        this.checkStatus();
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected disconnectWhatsApp() {
    this.loading.set(true);
    this.statusMessage.set('Disconnecting...');
    
    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/disconnect`, {}).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set(response.message ?? '');
        this.checkStatus();
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected resetWhatsApp() {
    if (!confirm('This will clear your WhatsApp session and generate a new QR code. You will need to scan it again. Continue?')) {
      return;
    }

    this.loading.set(true);
    this.statusMessage.set('Resetting WhatsApp session...');
    
    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/reset`, {}).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set(response.message ?? '');
        // Start checking for QR code
        setTimeout(() => this.checkStatus(), 2000);
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected testPuppeteer() {
    this.loading.set(true);
    this.statusMessage.set('Testing if Chrome can launch on server...');
    
    this.http.get<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/test-puppeteer`).subscribe({
      next: (response) => {
        this.loading.set(false);
        if (response.success) {
          this.statusMessage.set(`✅ Server test passed! Browser: ${response.browserVersion}. Chrome path: ${response.chromePath}`);
        } else {
          this.statusMessage.set(`❌ Server test failed: ${response.error}`);
        }
      },
      error: (error) => {
        this.loading.set(false);
        const errorMsg = error.error?.error || error.message;
        const suggestion = error.error?.suggestion || '';
        
        if (errorMsg.includes('Could not find Chrome')) {
          this.statusMessage.set('❌ Chrome not installed on server. SSH and run: sudo apt-get update && sudo apt-get install -y chromium-browser');
        } else if (errorMsg.includes('spawn') || errorMsg.includes('ENOENT')) {
          this.statusMessage.set('❌ Chrome missing. Install: sudo apt-get install -y chromium-browser');
        } else {
          this.statusMessage.set(`❌ Test failed: ${errorMsg}. ${suggestion}`);
        }
      }
    });
  }

  protected loadContacts() {
    this.http.get<{ contacts: Contact[] }>(`${this.apiUrl}/api/whatsapp/contacts`).subscribe({
      next: (response) => {
        this.contacts.set(response.contacts);
      },
      error: (error) => {
        console.error('Error loading contacts:', error);
        this.statusMessage.set('Error loading contacts: ' + (error.error?.error || error.message));
      }
    });
  }

  protected addContact() {
    const name = this.newContactName();
    const number = this.newContactNumber();
    
    if (!name || !number) {
      this.statusMessage.set('Please enter both name and number');
      return;
    }
    
    this.loading.set(true);
    
    this.http.post<{ success: boolean; contact: Contact }>(`${this.apiUrl}/api/whatsapp/contacts`, {
      name,
      number
    }).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set('Contact added successfully');
        this.newContactName.set('');
        this.newContactNumber.set('');
        this.loadContacts();
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected deleteContact(contactId: string) {
    if (!confirm('Are you sure you want to delete this contact?')) {
      return;
    }
    
    this.http.delete<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/contacts/${contactId}`).subscribe({
      next: (response) => {
        this.statusMessage.set('Contact deleted successfully');
        this.loadContacts();
      },
      error: (error) => {
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected toggleContactSelection(contactId: string) {
    const selected = new Set(this.selectedContacts());
    if (selected.has(contactId)) {
      selected.delete(contactId);
    } else {
      selected.add(contactId);
    }
    this.selectedContacts.set(selected);
  }

  protected selectAllContacts() {
    const allIds = new Set(this.contacts().map(c => c.id));
    this.selectedContacts.set(allIds);
  }

  protected deselectAllContacts() {
    this.selectedContacts.set(new Set());
  }

  protected sendMessage() {
    if (!this.message()) {
      this.statusMessage.set('Please enter a message');
      return;
    }

    const selected = Array.from(this.selectedContacts());
    if (selected.length === 0) {
      this.statusMessage.set('Please select at least one contact');
      return;
    }

    this.loading.set(true);
    this.statusMessage.set('Sending messages...');

    if (selected.length === 1) {
      // Send single message
      this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/send-message`, {
        contactId: selected[0],
        message: this.message()
      }).subscribe({
        next: (response) => {
          this.loading.set(false);
          this.statusMessage.set(`Message sent to ${response.sentTo}`);
          this.message.set('');
        },
        error: (error) => {
          this.loading.set(false);
          this.statusMessage.set('Error: ' + (error.error?.error || error.message));
        }
      });
    } else {
      // Send bulk messages
      this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/send-bulk`, {
        contactIds: selected,
        message: this.message()
      }).subscribe({
        next: (response) => {
          this.loading.set(false);
          const successCount = response.results.filter(r => r.success).length;
          this.statusMessage.set(`Messages sent: ${successCount}/${response.results.length}`);
          this.message.set('');
        },
        error: (error) => {
          this.loading.set(false);
          this.statusMessage.set('Error: ' + (error.error?.error || error.message));
        }
      });
    }
  }

  protected getStatusColor(): string {
    const status = this.status().status;
    switch (status) {
      case 'ready': return 'green';
      case 'qr_code': return 'orange';
      case 'authenticated': return 'lightgreen';
      case 'disconnected': return 'red';
      default: return 'gray';
    }
  }

  protected getStatusText(): string {
    const status = this.status().status;
    switch (status) {
      case 'ready': return 'Connected';
      case 'qr_code': return 'Scan QR Code';
      case 'authenticated': return 'Authenticating...';
      case 'disconnected': return 'Disconnected';
      case 'auth_failure': return 'Authentication Failed';
      default: return status;
    }
  }

  private updateQrImage(qrText: string | null) {
    if (qrText === this.lastQrText) return;
    this.lastQrText = qrText;

    if (!qrText) {
      this.qrImage.set('');
      return;
    }

    QRCode.toDataURL(qrText, { width: 300, margin: 1 })
      .then(image => {
        // Ignore the result if a newer code arrived while this one was being drawn
        if (this.lastQrText === qrText) this.qrImage.set(image);
      })
      .catch(error => console.error('Error drawing the QR code:', error));
  }

  protected fetchWhatsAppContacts() {
    if (!this.status().isReady) {
      this.statusMessage.set('WhatsApp is not connected. Please connect first.');
      return;
    }

    this.importLoading.set(true);
    this.statusMessage.set('Fetching contacts from WhatsApp...');

    this.http.get<{ success: boolean; contacts: WhatsAppContact[]; count: number }>(`${this.apiUrl}/api/whatsapp/whatsapp-contacts`).subscribe({
      next: (response) => {
        console.log('Fetched WhatsApp contacts:', response);
        this.importLoading.set(false);
        this.whatsappContacts.set(response.contacts);
        this.showImportDialog.set(true);
        this.statusMessage.set(`Found ${response.count} contacts in WhatsApp`);
      },
      error: (error) => {
        console.error('Fetch contacts error:', error);
        this.importLoading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected toggleWhatsAppContactSelection(number: string) {
    const selected = new Set(this.selectedWhatsAppContacts());
    if (selected.has(number)) {
      selected.delete(number);
    } else {
      selected.add(number);
    }
    this.selectedWhatsAppContacts.set(selected);
  }

  protected selectAllWhatsAppContacts() {
    const allNumbers = new Set(this.whatsappContacts().map(c => c.number));
    this.selectedWhatsAppContacts.set(allNumbers);
  }

  protected deselectAllWhatsAppContacts() {
    this.selectedWhatsAppContacts.set(new Set());
  }

  protected importSelectedContacts() {
    const selected = Array.from(this.selectedWhatsAppContacts());
    
    if (selected.length === 0) {
      this.statusMessage.set('Please select at least one contact to import');
      return;
    }

    console.log('Importing contacts:', selected.length, 'selected');
    console.log('Selected numbers:', selected);

    this.importLoading.set(true);
    this.statusMessage.set('Importing contacts...');

    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/import-contacts`, {
      selectedNumbers: selected
    }).subscribe({
      next: (response) => {
        console.log('Import response:', response);
        this.importLoading.set(false);
        
        let message = response.message ?? '';
        if ((response.notFoundCount ?? 0) > 0) {
          message += ` (${response.notFoundCount} not found)`;
        }
        
        this.statusMessage.set(message);
        this.showImportDialog.set(false);
        this.selectedWhatsAppContacts.set(new Set());
        this.whatsappContacts.set([]);
        
        // Reload contacts to show the newly imported ones
        this.loadContacts();
      },
      error: (error) => {
        console.error('Import error:', error);
        this.importLoading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected cancelImport() {
    this.showImportDialog.set(false);
    this.selectedWhatsAppContacts.set(new Set());
    this.whatsappContacts.set([]);
  }

  // ==================== GROUP MANAGEMENT ====================

  protected loadGroups() {
    this.http.get<{ success: boolean; groups: Group[] }>(`${this.apiUrl}/api/whatsapp/groups`).subscribe({
      next: (response) => {
        console.log('Loaded groups:', response.groups);
        this.groups.set(response.groups);
        // Restore selected group if it still exists
        const savedGroupId = localStorage.getItem('selectedWhatsAppGroup');
        if (savedGroupId && response.groups.some(g => g.id === savedGroupId)) {
          this.selectedGroup.set(savedGroupId);
          this.loadMessageHistory();
        }
      },
      error: (error) => {
        console.error('Error loading groups:', error);
      }
    });
  }

  protected loadSelectedGroup() {
    const savedGroupId = localStorage.getItem('selectedWhatsAppGroup');
    if (savedGroupId) {
      this.selectedGroup.set(savedGroupId);
    }
  }

  protected saveSelectedGroup() {
    const groupId = this.selectedGroup();
    if (groupId) {
      localStorage.setItem('selectedWhatsAppGroup', groupId);
      console.log('Saved selected group:', groupId);
      this.loadMessageHistory();
    }
  }

  protected loadMessageHistory() {
    const groupId = this.selectedGroup();
    if (!groupId) {
      this.sentMessages.set([]);
      return;
    }

    this.http.get<{ success: boolean; messages: SentMessage[] }>(`${this.apiUrl}/api/whatsapp/messages/${groupId}`).subscribe({
      next: (response) => {
        this.sentMessages.set(response.messages);
        this.selectedMessages.set(new Set());
      },
      error: (error) => {
        console.error('Error loading message history:', error);
      }
    });
  }

  protected toggleMessageSelection(messageId: string) {
    const selected = this.selectedMessages();
    const newSelected = new Set(selected);
    
    if (newSelected.has(messageId)) {
      newSelected.delete(messageId);
    } else {
      newSelected.add(messageId);
    }
    
    this.selectedMessages.set(newSelected);
  }

  protected selectAllMessages() {
    const allIds = this.sentMessages().map(m => m.id);
    this.selectedMessages.set(new Set(allIds));
  }

  protected deselectAllMessages() {
    this.selectedMessages.set(new Set());
  }

  protected createGroup() {
    const name = this.newGroupName();
    const selectedContacts = Array.from(this.selectedContactsForGroup());
    
    if (!name) {
      this.statusMessage.set('Please enter a group name');
      return;
    }

    if (selectedContacts.length === 0) {
      this.statusMessage.set('Please select at least one contact for the group');
      return;
    }

    this.loading.set(true);

    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/groups`, {
      name,
      contactIds: selectedContacts
    }).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set(response.message ?? '');
        this.newGroupName.set('');
        this.selectedContactsForGroup.set(new Set());
        this.loadGroups();
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected editGroup(group: Group) {
    this.editingGroup.set(group);
    this.newGroupName.set(group.name);
    this.selectedContactsForGroup.set(new Set(group.contactIds));
  }

  protected updateGroup() {
    const group = this.editingGroup();
    if (!group) return;

    const name = this.newGroupName();
    const selectedContacts = Array.from(this.selectedContactsForGroup());

    if (!name) {
      this.statusMessage.set('Please enter a group name');
      return;
    }

    console.log('Updating group:', group.id, name);
    console.log('Selected contact IDs:', selectedContacts);

    this.loading.set(true);

    this.http.put<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/groups/${group.id}`, {
      name,
      contactIds: selectedContacts
    }).subscribe({
      next: (response) => {
        console.log('Group updated response:', response);
        this.loading.set(false);
        this.statusMessage.set(response.message + ` (${response.group.contactCount} contacts)`);
        this.cancelGroupEdit();
        this.loadGroups();
      },
      error: (error) => {
        console.error('Update group error:', error);
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected cancelGroupEdit() {
    this.editingGroup.set(null);
    this.newGroupName.set('');
    this.selectedContactsForGroup.set(new Set());
  }

  protected deleteGroup(groupId: string) {
    if (!confirm('Are you sure you want to delete this group?')) {
      return;
    }

    this.http.delete<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/groups/${groupId}`).subscribe({
      next: (response) => {
        this.statusMessage.set('Group deleted successfully');
        this.loadGroups();
      },
      error: (error) => {
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected toggleContactForGroup(contactId: string) {
    const selected = new Set(this.selectedContactsForGroup());
    if (selected.has(contactId)) {
      selected.delete(contactId);
    } else {
      selected.add(contactId);
    }
    this.selectedContactsForGroup.set(selected);
  }

  protected selectAllContactsForGroup() {
    const allIds = new Set(this.contacts().map(c => c.id));
    this.selectedContactsForGroup.set(allIds);
  }

  protected deselectAllContactsForGroup() {
    this.selectedContactsForGroup.set(new Set());
  }

  protected sendMessageToGroup() {
    const groupId = this.selectedGroup();
    
    if (!groupId) {
      this.statusMessage.set('Please select a group');
      return;
    }

    if (!this.message()) {
      this.statusMessage.set('Please enter a message');
      return;
    }

    this.loading.set(true);
    this.statusMessage.set('Sending message to group...');

    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/send-to-group`, {
      groupId,
      message: this.message()
    }).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set(response.message ?? '');
        this.message.set('');
        this.loadMessageHistory(); // Reload message history
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected copyMessageToField(messageText: string) {
    this.message.set(messageText);
    this.statusMessage.set('Message copied to input field');
    setTimeout(() => this.statusMessage.set(''), 2000);
  }

  protected deleteSingleMessage(messageId: string) {
    if (!confirm('Are you sure you want to delete this message? This will delete it for everyone.')) {
      return;
    }

    this.loading.set(true);
    this.statusMessage.set('Deleting message...');

    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/delete-messages`, {
      messageIds: [messageId]
    }).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set(response.message ?? '');
        this.loadMessageHistory(); // Reload message history
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected deleteAllMessages() {
    const messages = this.sentMessages();
    if (messages.length === 0) {
      return;
    }

    if (!confirm(`Are you sure you want to delete all ${messages.length} message(s)? This will delete them for everyone.`)) {
      return;
    }

    this.loading.set(true);
    this.statusMessage.set('Deleting all messages...');

    const messageIds = messages.map(m => m.id);

    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/delete-messages`, {
      messageIds
    }).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set(response.message ?? '');
        this.loadMessageHistory(); // Reload message history
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
      }
    });
  }

  protected getGroupContactNames(group: Group): string {
    console.log('Getting contact names for group:', group.name);
    console.log('Group contact IDs:', group.contactIds);
    console.log('Available contacts:', this.contacts());
    
    const contactNames = group.contactIds
      .map(id => {
        const contact = this.contacts().find(c => c.id === id);
        console.log(`Looking for contact with ID ${id}:`, contact);
        return contact?.name;
      })
      .filter(name => name);
    
    console.log('Found contact names:', contactNames);
    
    if (contactNames.length === 0) return 'No contacts';
    if (contactNames.length <= 3) return contactNames.join(', ');
    return `${contactNames.slice(0, 3).join(', ')} +${contactNames.length - 3} more`;
  }

  protected triggerCamera() {
    const input = this.cameraInput();
    if (input) {
      input.nativeElement.click();
    }
  }

  protected onImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.compressAndSendImage(file);
    }
  }

  protected async compressAndSendImage(file: File) {
    try {
      this.loading.set(true);
      this.statusMessage.set('Compressing image...');

      const compressedFile = await this.compressImage(file);
      this.sendImageToGroup(compressedFile);
    } catch (error) {
      this.loading.set(false);
      this.statusMessage.set('Error compressing image: ' + error);
    }
  }

  protected compressImage(file: File): Promise<File> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          // Resize if image is too large (max 1920px on longest side)
          const maxSize = 1920;
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = (height / width) * maxSize;
              width = maxSize;
            } else {
              width = (width / height) * maxSize;
              height = maxSize;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject('Could not get canvas context');
            return;
          }
          
          ctx.drawImage(img, 0, 0, width, height);
          
          // Compress to JPEG with 85% quality
          canvas.toBlob((blob) => {
            if (!blob) {
              reject('Could not compress image');
              return;
            }
            
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            
            resolve(compressedFile);
          }, 'image/jpeg', 0.85);
        };
        
        img.onerror = () => reject('Could not load image');
      };
      
      reader.onerror = () => reject('Could not read file');
    });
  }

  protected sendImageToGroup(imageFile: File) {
    const groupId = this.selectedGroup();
    
    if (!groupId) {
      this.statusMessage.set('Please select a group');
      return;
    }

    this.loading.set(true);
    this.statusMessage.set('Sending image to group...');

    // Create FormData to send the image
    const formData = new FormData();
    formData.append('groupId', groupId);
    formData.append('image', imageFile);
    
    // Add caption if there's a message
    const messageText = this.message();
    if (messageText) {
      formData.append('caption', messageText);
    }

    this.http.post<WhatsAppResponse>(`${this.apiUrl}/api/whatsapp/send-image-to-group`, formData).subscribe({
      next: (response) => {
        this.loading.set(false);
        this.statusMessage.set(response.message ?? '');
        this.message.set('');
        
        // Clear the file input
        const input = this.cameraInput();
        if (input) {
          input.nativeElement.value = '';
        }
        
        this.loadMessageHistory();
      },
      error: (error) => {
        this.loading.set(false);
        this.statusMessage.set('Error: ' + (error.error?.error || error.message));
        
        // Clear the file input
        const input = this.cameraInput();
        if (input) {
          input.nativeElement.value = '';
        }
      }
    });
  }

}
