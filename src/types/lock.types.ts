/**
 * Types for Request Processing Lock
 */

export interface LockHandle {
  requestId: string;
  acquiredAt: Date;
  release(): void;
}

export interface LockMetrics {
  requestId: string;
  acquiredAt: Date;
  releasedAt?: Date;
  duration?: number;  // milliseconds
  queuedCalls: number;
}
