import { HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { Observable, catchError, of, tap, throwError } from 'rxjs';

const CACHE_PREFIX = 'itb-offline-http-v1';

function cacheKey(req: HttpRequest<unknown>): string {
  return `${CACHE_PREFIX}:${req.urlWithParams}`;
}

function writeCache(req: HttpRequest<unknown>, body: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(req), JSON.stringify(body));
  } catch {
    // Ignore quota/private mode failures, app will still use memory/network path.
  }
}

function readCache(req: HttpRequest<unknown>): unknown | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(req));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function shouldTryOfflineFallback(error: any): boolean {
  const status = error?.status;
  if (status === 0) return true;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return false;
}

export const offlineCacheInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> => {
  const isApiGet = req.method === 'GET' && req.url.includes('/api/');

  if (!isApiGet) {
    return next(req);
  }

  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) {
        writeCache(req, event.body);
      }
    }),
    catchError((error) => {
      if (!shouldTryOfflineFallback(error)) {
        return throwError(() => error);
      }

      const cachedBody = readCache(req);
      if (cachedBody === null) {
        return throwError(() => error);
      }

      return of(new HttpResponse({
        status: 200,
        body: cachedBody,
        url: req.urlWithParams,
      }));
    })
  );
};
