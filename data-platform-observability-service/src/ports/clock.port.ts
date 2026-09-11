// Every time-sensitive computation (SLA evaluation, stuck-run detection,
// poll scheduling) goes through a Clock rather than `new Date()` directly,
// so tests never depend on actual wall-clock time.
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
