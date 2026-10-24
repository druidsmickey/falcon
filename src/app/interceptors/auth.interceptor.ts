import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const injector = inject(Injector);
  const token = localStorage.getItem('token');
  const appContext = localStorage.getItem('appContext') || 'default';

  const cloned = token
    ? req.clone({
        headers: req.headers
          .set('Authorization', `Bearer ${token}`)
          .set('X-App-Context', appContext)
      })
    : req.clone({
        headers: req.headers.set('X-App-Context', appContext)
      });

  return next(cloned).pipe(
    catchError((error: unknown) => {
      // Expired or invalid token: go back to the login page. The /auth/ calls (login,
      // change password) answer 401 for a wrong password, which must not log the user out.
      const status = error instanceof HttpErrorResponse ? error.status : 0;
      if ((status === 401 || status === 403) && token && !req.url.includes('/auth/')) {
        injector.get(AuthService).logout();
      }
      return throwError(() => error);
    })
  );
};
