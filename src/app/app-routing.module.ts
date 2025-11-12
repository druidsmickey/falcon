import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SingleComponent } from './single/single.component';
import { EventsComponent } from './events/events.component';
import { ParamsComponent } from './params/params.component';
import { BetslipComponent } from './betslip/betslip.component';
import { ListComponent } from './list/list.component';

const routes: Routes = [
  { path: 'single', component: SingleComponent },
  { path: 'betslip', component: BetslipComponent },
  { path: 'list', component: ListComponent },
  { path: 'events', component: EventsComponent },
  { path: 'params', component: ParamsComponent },
  { path: '', redirectTo: '/events', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
