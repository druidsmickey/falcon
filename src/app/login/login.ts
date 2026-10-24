import { Component, ChangeDetectorRef, ChangeDetectionStrategy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { AuthService, SignInResult } from '../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private authService = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  username = '';
  password = '';
  oldPassword = '';
  errorMessage = '';
  isLoading = false;

  // 'old-password': the password was changed elsewhere and the saved data on this device still needs the old one
  step: 'login' | 'old-password' = 'login';

  async onLogin(): Promise<void> {
    if (!this.username || !this.password) {
      this.errorMessage = 'Please enter both username and password';
      return;
    }

    await this.run(() => this.authService.signIn(this.username, this.password));
  }

  async onContinueWithOldPassword(): Promise<void> {
    if (!this.oldPassword) {
      this.errorMessage = 'Please enter the previous password';
      return;
    }

    await this.run(() => this.authService.continueWithOldPassword(this.oldPassword));
  }

  async onDiscardSavedData(): Promise<void> {
    const sure = confirm(
      'Bets that were saved on this device but not yet sent will be lost.\n\nContinue without the previous password?'
    );
    if (!sure) return;

    await this.run(() => this.authService.discardSavedDataAndContinue());
  }

  private async run(attempt: () => Promise<SignInResult>): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.detectChanges();

    const result = await attempt();

    switch (result.status) {
      case 'ok':
      case 'offline':
        await this.router.navigate(['/home']);
        break;
      case 'duress':
        // the page is leaving; nothing more to show
        return;
      case 'old-password-needed':
        this.step = 'old-password';
        this.oldPassword = '';
        break;
      case 'invalid':
      case 'unreachable':
        this.errorMessage = result.message;
        break;
    }

    this.isLoading = false;
    this.cdr.detectChanges();
  }
}
