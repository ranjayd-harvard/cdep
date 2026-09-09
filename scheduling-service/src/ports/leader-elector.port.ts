// AGENTS.md section 14-15: leadership is an optimization/control mechanism
// (only the leader runs the scan/reconcile loop), never the correctness
// guarantee — execution-key uniqueness stays the correctness guarantee
// even if two processes briefly believe they're leader.
export interface LeaderElector {
  isLeader(): boolean;
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}
