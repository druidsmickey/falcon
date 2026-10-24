import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DeviceWipeService } from '../security/device-wipe.service';
import { DuressService } from '../security/duress.service';
import { VaultService } from '../security/vault.service';
import { OfflineStoreService } from '../services/offline-store.service';

@Component({
  selector: 'app-device-security',
  imports: [ReactiveFormsModule],
  templateUrl: './device-security.html',
  styleUrl: './device-security.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceSecurity {
  private duress = inject(DuressService);
  private vault = inject(VaultService);
  private wipe = inject(DeviceWipeService);
  private offlineStore = inject(OfflineStoreService);
  private fb = inject(FormBuilder);

  protected readonly duressIsSet = signal(this.duress.isSet());
  protected readonly message = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);

  protected readonly form = this.fb.nonNullable.group({
    code: ['', [Validators.required, Validators.minLength(6)]],
    confirm: ['', Validators.required],
  });

  protected async saveDuressCode(): Promise<void> {
    this.message.set('');
    this.error.set('');

    const { code, confirm } = this.form.getRawValue();
    if (this.form.invalid) {
      this.error.set('The duress code must be at least 6 characters long.');
      return;
    }
    if (code !== confirm) {
      this.error.set('The two codes are not the same.');
      return;
    }

    this.busy.set(true);
    try {
      // typed instead of the password it would wipe the device by mistake if it were the same
      if (await this.vault.checkPassword(code)) {
        this.error.set('The duress code must be different from your password.');
        return;
      }
      await this.duress.set(code);
      this.duressIsSet.set(true);
      this.form.reset();
      this.message.set('The duress code is set. Typed instead of your password on the login page, it erases this device and shows a game.');
    } finally {
      this.busy.set(false);
    }
  }

  protected removeDuressCode(): void {
    this.duress.remove();
    this.duressIsSet.set(false);
    this.error.set('');
    this.message.set('The duress code was removed.');
  }

  protected async eraseDevice(): Promise<void> {
    const waiting = await this.offlineStore.countWaiting();
    const warning =
      waiting > 0
        ? `\n\n${waiting} saved change(s) have not been sent to the server yet and will be lost.`
        : '';

    if (!confirm(`Erase all data stored on this device? The data on the server is not touched.${warning}`)) return;

    this.busy.set(true);
    await this.wipe.wipeAndLeave('login');
  }
}
