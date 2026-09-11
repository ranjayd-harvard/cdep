// Leadership is an optimization mechanism for the write-side reconciliation
// loop (only the leader runs a repair pass), never the correctness
// guarantee — the join-key UNIQUE constraints and event_id dedup stay
// correct even if two processes briefly believe they're leader.
export interface LeaderElector {
  isLeader(): boolean;
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}
