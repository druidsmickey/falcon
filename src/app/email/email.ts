import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-email',
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCardModule
  ],
  templateUrl: './email.html',
  styleUrl: './email.css',
})
export class Email {
  protected showCc = signal(false);
  protected showBcc = signal(false);
  protected to = signal('');
  protected cc = signal('');
  protected bcc = signal('');
  protected subject = signal('');
  protected message = signal('');
  protected attachments = signal<File[]>([]);

  toggleCc() {
    this.showCc.set(!this.showCc());
  }

  toggleBcc() {
    this.showBcc.set(!this.showBcc());
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      const files = Array.from(input.files);
      this.attachments.set([...this.attachments(), ...files]);
    }
  }

  removeAttachment(index: number) {
    const current = this.attachments();
    this.attachments.set(current.filter((_, i) => i !== index));
  }

  sendEmail() {
    // TODO: Implement email sending logic
    console.log('Sending email:', {
      to: this.to(),
      cc: this.cc(),
      bcc: this.bcc(),
      subject: this.subject(),
      message: this.message(),
      attachments: this.attachments().map(f => f.name)
    });
    alert('Email sending functionality will be implemented here');
  }

  clearForm() {
    this.to.set('');
    this.cc.set('');
    this.bcc.set('');
    this.subject.set('');
    this.message.set('');
    this.attachments.set([]);
    this.showCc.set(false);
    this.showBcc.set(false);
  }
}
