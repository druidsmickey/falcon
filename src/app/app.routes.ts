import { Routes } from '@angular/router';
import { Login } from './login/login';
import { App } from './app';
import { authGuard } from './guards/auth.guard';
import { ChangePassword } from './change-password/change-password';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: Login },
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
