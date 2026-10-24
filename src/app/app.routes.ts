import { Routes } from '@angular/router';
import { Login } from './login/login';
import { App } from './app';
import { authGuard } from './guards/auth.guard';
import { ChangePassword } from './change-password/change-password';
import { Arcade } from './arcade/arcade';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: Login },
  // a game that needs no login (the duress code leads here)
  { path: 'arcade', component: Arcade },
  { 
    path: 'home', 
    component: App,
    canActivate: [authGuard]
  },
  {
    path: 'change-password',
    component: ChangePassword,
    canActivate: [authGuard]
  }
];
