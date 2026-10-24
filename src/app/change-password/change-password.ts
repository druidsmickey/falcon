
import { Component, ChangeDetectorRef, ChangeDetectionStrategy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { HttpErrorResponse } from '@angular/common/http';

@Component({
  selector: 'app-change-password',
  imports: [FormsModule],
  templateUrl: './change-password.html',
  styleUrl: './change-password.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePassword {
  private authService = inject(AuthService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  errorMessage = '';
  successMessage = '';
  isLoading = false;

  onSubmit() {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.currentPassword || !this.newPassword || !this.confirmPassword) {
      this.errorMessage = 'All fields are required';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.errorMessage = 'New password and confirm password do not match';
      return;
    }

    if (this.newPassword.length < 6) {
      this.errorMessage = 'New password must be at least 6 characters long';
      return;
    }

    this.isLoading = true;

    this.authService
      .changePassword(this.currentPassword, this.newPassword)
      .subscribe({
        next: (response: { message?: string }) => {
          this.isLoading = false;
          this.successMessage =
            response.message || 'Password changed successfully!';
          this.errorMessage = '';
          this.currentPassword = '';
          this.newPassword = '';
          this.confirmPassword = '';
          
          // Trigger change detection manually
          this.cdr.detectChanges();

          setTimeout(() => {
            this.router.navigate(['/home']);
          }, 2000);
        },
        error: (error: HttpErrorResponse) => {
          this.isLoading = false;
          this.successMessage = '';
          this.errorMessage =
            error.error?.message || 'An error occurred while changing password';
          
          // Trigger change detection manually
          this.cdr.detectChanges();
        },
      });
  }

  onCancel() {
    this.router.navigate(['/home']);
  }

}
