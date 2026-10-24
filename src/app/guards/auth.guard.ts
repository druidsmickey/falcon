import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const storedContext = localStorage.getItem('appContext') || 'default';
  const currentContext = authService.getCurrentAppContext();

  if (authService.isLoggedIn() && storedContext === currentContext) {
    return true;
  }

  if (authService.isLoggedIn() && storedContext !== currentContext) {
    authService.logout();
  }
  return router.createUrlTree(['/login']);
};
