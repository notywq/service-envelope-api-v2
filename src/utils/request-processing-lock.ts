/**
 * Request Processing Lock
 * Ensures only one orchestrator instance processes a request at a time
 */

import { Logger } from 'winston';
import { LockHandle, LockMetrics } from '../types/lock.types.js';

export class RequestProcessingLock {
  private locks = new Map<string, {
    promise: Promise<void>;
    resolve: () => void;
    queuedCount: number;
    acquiredAt: Date;
  }>();

  constructor(private logger: Logger) {}

  /**
   * Acquire a lock for a request
   * If already locked, waits in queue
   */
  async acquire(requestId: string): Promise<LockHandle> {
    const existingLock = this.locks.get(requestId);

    if (existingLock) {
      // Lock already held, queue this call
      existingLock.queuedCount++;
      this.logger.info(
        `[LOCK-QUEUED] RequestId: ${requestId} | Request already processing | Queued: ${existingLock.queuedCount}`
      );

      // Wait for the current lock to finish
      await existingLock.promise;
    }

    // Now acquire the lock
    let resolveFunc: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveFunc = resolve;
    });

    const acquiredAt = new Date();
    this.locks.set(requestId, {
      promise,
      resolve: resolveFunc!,
      queuedCount: 0,
      acquiredAt,
    });

    this.logger.info(`[LOCK-ACQUIRED] RequestId: ${requestId} | Lock acquired`);

    // Return handle for releasing lock
    return {
      requestId,
      acquiredAt,
      release: () => this.release(requestId),
    };
  }

  /**
   * Try to acquire lock without waiting
   * Returns null if lock already held
   */
  async tryAcquire(requestId: string): Promise<LockHandle | null> {
    const existingLock = this.locks.get(requestId);

    if (existingLock) {
      this.logger.debug(
        `[LOCK-UNAVAILABLE] RequestId: ${requestId} | Lock already held`
      );
      return null;
    }

    // Acquire immediately
    let resolveFunc: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveFunc = resolve;
    });

    const acquiredAt = new Date();
    this.locks.set(requestId, {
      promise,
      resolve: resolveFunc!,
      queuedCount: 0,
      acquiredAt,
    });

    this.logger.info(`[LOCK-ACQUIRED] RequestId: ${requestId} | Lock acquired`);
    return {
      requestId,
      acquiredAt,
      release: () => this.release(requestId),
    };
  }

  /**
   * Release a lock
   */
  private release(requestId: string): void {
    const lock = this.locks.get(requestId);

    if (!lock) {
      this.logger.warn(`[LOCK-RELEASE-ERROR] RequestId: ${requestId} | Lock not found`);
      return;
    }

    const duration = Date.now() - lock.acquiredAt.getTime();
    const queuedCount = lock.queuedCount;

    this.logger.info(
      `[LOCK-RELEASED] RequestId: ${requestId} | Duration: ${duration}ms | Queued: ${queuedCount}`
    );

    // Resolve the promise to unblock waiting calls
    lock.resolve();

    // Remove from locks map
    this.locks.delete(requestId);
  }

  /**
   * Get metrics for a specific request
   */
  getMetrics(requestId: string): LockMetrics | null {
    const lock = this.locks.get(requestId);

    if (!lock) {
      return null;
    }

    return {
      requestId,
      acquiredAt: lock.acquiredAt,
      duration: Date.now() - lock.acquiredAt.getTime(),
      queuedCalls: lock.queuedCount,
    };
  }

  /**
   * Get all active locks
   */
  getAllMetrics(): LockMetrics[] {
    return Array.from(this.locks.entries()).map(([requestId, lock]) => ({
      requestId,
      acquiredAt: lock.acquiredAt,
      duration: Date.now() - lock.acquiredAt.getTime(),
      queuedCalls: lock.queuedCount,
    }));
  }

  /**
   * Check if request is currently locked
   */
  isLocked(requestId: string): boolean {
    return this.locks.has(requestId);
  }
}
