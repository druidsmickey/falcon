import { HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { VaultService } from '../security/vault.service';

// The copies of the answers are kept in the encrypted vault, under a name made from the address. While
// the vault is locked nothing is saved or read.
const cacheName = (req: HttpRequest<unknown>): string => `http:${req.urlWithParams}`;

function writeCache(vault: VaultService, req: HttpRequest<unknown>, body: unknown): void {
  vault.setItem(cacheName(req), body);
}

function readCache(vault: VaultService, req: HttpRequest<unknown>): unknown | null {
  return vault.getItem<unknown>(cacheName(req));
}

function shouldTryOfflineFallback(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 0) return true;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return false;
}

export const offlineCacheInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> => {
  const vault = inject(VaultService);
  const isApiGet = req.method === 'GET' && req.url.includes('/api/');

  if (!isApiGet) {
    return next(req);
  }

  return next(req).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) {
        writeCache(vault, req, event.body);
      }
    }),
    catchError((error) => {
      if (!shouldTryOfflineFallback(error)) {
        return throwError(() => error);
      }

      const cachedBody = readCache(vault, req);
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
