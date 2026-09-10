import { StateManager } from '../state-manager';
import { logger } from '../logger';

export class IdempotencyGuard {
  private stateManager: StateManager;

  constructor(stateManager: StateManager) {
    this.stateManager = stateManager;
  }

  public shouldBlockSubmission(): boolean {
    const state = this.stateManager.getState();
    if (state.status === 'SUBMITTED') {
      logger.warn(`IdempotencyGuard: Application for candidate ${state.candidateId} is already marked SUBMITTED on disk. Blocking duplicate submission attempt.`, {
        applicationId: state.applicationId,
        submittedAt: state.submissionReceipt?.submittedAt
      });
      return true;
    }
    return false;
  }

  public getIdempotencyKey(): string {
    return this.stateManager.getState().idempotencyKey;
  }
}
