import { logger } from "../../common/logger/logger.js";

// A generic interval runner shared by every pull-adapter poller (plan
// section 4). No correctness property depends on exact tick alignment —
// idempotent dedup (event_id) plus the join-key correlation index absorb
// any cadence, so a plain setInterval per adapter is sufficient for local
// development, same rationale as scheduling-service's SchedulerLoop.
export class PollLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = false;

  constructor(
    private readonly name: string,
    private readonly intervalSeconds: number,
    private readonly tick: () => Promise<void>,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;

    const run = () => {
      if (this.inFlight) return;
      this.inFlight = true;
      this.tick()
        .catch((err) => logger.error({ err, poller: this.name }, "poller tick failed"))
        .finally(() => {
          this.inFlight = false;
        });
    };

    run();
    this.timer = setInterval(run, this.intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
  }
}
