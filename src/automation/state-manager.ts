import fs from 'fs';
import path from 'path';
import { ApplicationState, CandidateProfile, StepName, STEP_ORDER } from './types';
import { logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

export class StateManager {
  private stateDir: string;
  private stateFilePath: string;
  private state: ApplicationState;

  constructor(candidate: CandidateProfile, stateDir: string = path.join(process.cwd(), 'state')) {
    this.stateDir = stateDir;
    if (!fs.existsSync(this.stateDir)) {
      fs.mkdirSync(this.stateDir, { recursive: true });
    }

    const safeId = candidate.candidateId.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.stateFilePath = path.join(this.stateDir, `app_${safeId}.json`);

    this.state = this.loadOrCreate(candidate);
  }

  private loadOrCreate(candidate: CandidateProfile): ApplicationState {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const loaded: ApplicationState = JSON.parse(raw);
        logger.info(`Loaded existing application checkpoint from disk for candidate ${candidate.candidateId}`, {
          completedSteps: loaded.completedSteps,
          currentStep: loaded.currentStep,
          status: loaded.status
        });
        return loaded;
      } catch (err: any) {
        logger.warn(`Failed to parse existing state file (${err.message}). Initializing new state.`);
      }
    }

    const initialState: ApplicationState = {
      candidateId: candidate.candidateId,
      email: candidate.personalInfo.email,
      applicationId: null,
      status: 'PENDING',
      currentStep: 'PERSONAL_INFO',
      completedSteps: [],
      stepAttempts: {
        PERSONAL_INFO: 0,
        EDUCATION: 0,
        EXPERIENCE: 0,
        RESUME_UPLOAD: 0,
        REVIEW: 0,
        SUBMIT: 0
      },
      idempotencyKey: `idemp_${Date.now()}_${uuidv4().substring(0, 8)}`,
      lastUpdated: new Date().toISOString(),
      history: []
    };

    this.persist(initialState);
    return initialState;
  }

  private persist(stateToSave: ApplicationState = this.state): void {
    stateToSave.lastUpdated = new Date().toISOString();
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(stateToSave, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error(`Failed to persist state file ${this.stateFilePath}: ${err.message}`);
    }
  }

  public getState(): ApplicationState {
    return { ...this.state };
  }

  public isSubmitted(): boolean {
    return this.state.status === 'SUBMITTED';
  }

  public isStepCompleted(step: StepName): boolean {
    return this.state.completedSteps.includes(step);
  }

  public getNextPendingStep(): StepName | null {
    for (const step of STEP_ORDER) {
      if (!this.state.completedSteps.includes(step)) {
        return step;
      }
    }
    return null;
  }

  public markStepStarted(step: StepName): number {
    this.state.currentStep = step;
    this.state.status = 'IN_PROGRESS';
    this.state.stepAttempts[step] = (this.state.stepAttempts[step] || 0) + 1;

    this.state.history.push({
      step,
      timestamp: new Date().toISOString(),
      status: 'STARTED',
      attempt: this.state.stepAttempts[step]
    });

    this.persist();
    return this.state.stepAttempts[step];
  }

  public markStepCompleted(step: StepName, meta: Record<string, any> = {}): void {
    if (!this.state.completedSteps.includes(step)) {
      this.state.completedSteps.push(step);
    }

    if (meta.applicationId) {
      this.state.applicationId = meta.applicationId;
    }

    const nextStep = this.getNextPendingStep();
    if (nextStep) {
      this.state.currentStep = nextStep;
    }

    this.state.history.push({
      step,
      timestamp: new Date().toISOString(),
      status: 'COMPLETED',
      attempt: this.state.stepAttempts[step]
    });

    this.persist();
    logger.info(`Step [${step}] marked COMPLETED. Total completed: ${this.state.completedSteps.length}/${STEP_ORDER.length}`);
  }

  public markStepFailed(step: StepName, error: string): void {
    this.state.status = 'RETRYING';
    this.state.history.push({
      step,
      timestamp: new Date().toISOString(),
      status: 'FAILED',
      attempt: this.state.stepAttempts[step],
      error
    });
    this.persist();
  }

  public markRecovery(step: StepName, reason: string): void {
    this.state.status = 'RECOVERING';
    this.state.history.push({
      step,
      timestamp: new Date().toISOString(),
      status: 'RECOVERED',
      attempt: this.state.stepAttempts[step],
      error: `Recovered: ${reason}`
    });
    this.persist();
    logger.warn(`Application state marked RECOVERING on step [${step}] due to: ${reason}`);
  }

  public markSubmitted(receipt: { applicationId: string; submittedAt: string; isDuplicate: boolean }): void {
    this.state.status = 'SUBMITTED';
    this.state.applicationId = receipt.applicationId;
    this.state.submissionReceipt = receipt;
    if (!this.state.completedSteps.includes('SUBMIT')) {
      this.state.completedSteps.push('SUBMIT');
    }
    this.state.history.push({
      step: 'SUBMIT',
      timestamp: new Date().toISOString(),
      status: 'COMPLETED',
      attempt: this.state.stepAttempts['SUBMIT']
    });
    this.persist();
    logger.info(`Application ${receipt.applicationId} marked SUBMITTED and permanently locked on disk. Duplicate submission prevented.`);
  }

  public clear(): void {
    if (fs.existsSync(this.stateFilePath)) {
      fs.unlinkSync(this.stateFilePath);
    }
  }
}
