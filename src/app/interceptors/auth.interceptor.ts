import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token');
  const appContext = localStorage.getItem('appContext') || 'default';
  
  if (token) {
    const cloned = req.clone({
      headers: req.headers
        .set('Authorization', `Bearer ${token}`)
        .set('X-App-Context', appContext)
    });
    return next(cloned);
  }

  const cloned = req.clone({
    headers: req.headers.set('X-App-Context', appContext)
  });
  
  return next(cloned);
};
