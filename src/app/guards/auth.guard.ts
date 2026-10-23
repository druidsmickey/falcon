import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const storedContext = localStorage.getItem('appContext') || 'default';
  const currentContext = authService.getCurrentAppContext();

  if (authService.isLoggedIn() && storedContext === currentContext) {
    return true;
  } else {
    if (authService.isLoggedIn() && storedContext !== currentContext) {
      authService.logout();
    }
    router.navigate(['/login']);
    return false;
  }
};
