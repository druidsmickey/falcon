import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Dataentry } from './dataentry';

describe('Dataentry', () => {
  let component: Dataentry;
  let fixture: ComponentFixture<Dataentry>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dataentry]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Dataentry);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
