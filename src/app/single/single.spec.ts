import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Single } from './single';

describe('Single', () => {
  let component: Single;
  let fixture: ComponentFixture<Single>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Single]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Single);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
