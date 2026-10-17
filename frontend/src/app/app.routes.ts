import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', title: 'Dashboard - MediDocs AI', loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent) },
  { path: 'documents', title: 'Documents - MediDocs AI', loadComponent: () => import('./pages/documents/documents').then((m) => m.DocumentsComponent) },
  { path: 'chat', title: 'Ask - MediDocs AI', loadComponent: () => import('./pages/chat/chat').then((m) => m.ChatComponent) },
  { path: 'settings', title: 'Settings - MediDocs AI', loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsComponent) },
  { path: '**', redirectTo: '' },
];
