import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Winners } from './winners';

describe('Winners', () => {
  let component: Winners;
  let fixture: ComponentFixture<Winners>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Winners]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Winners);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
