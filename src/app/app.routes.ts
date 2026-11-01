import { Routes } from '@angular/router';
import { Login } from './login/login';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: Login },
  // a game that needs no login (the duress code leads here)
  { path: 'arcade', loadComponent: () => import('./arcade/arcade').then(m => m.Arcade) },
  { 
    path: 'home', 
    loadComponent: () => import('./app').then(m => m.App),
    canActivate: [authGuard]
  },
  {
    path: 'change-password',
    loadComponent: () => import('./change-password/change-password').then(m => m.ChangePassword),
    canActivate: [authGuard]
  }
];
