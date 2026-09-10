import { Request, Response, NextFunction } from 'express';
import { ChaosConfig } from './types';

export const chaosState: ChaosConfig = {
  sessionExpiryInjected: false,
  networkLatencyMs: 0,
  forceServerErrorSteps: [],
  serverCrashTriggered: false
};

// Middleware to inject network delay or simulated server errors
export function chaosMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply chaos to API requests, not static files
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  // Check headers for on-the-fly fault injection
  const delayHeader = req.headers['x-simulate-delay'];
  const errorStepHeader = req.headers['x-simulate-error-step'];

  let delay = chaosState.networkLatencyMs;
  if (delayHeader && typeof delayHeader === 'string') {
    delay = parseInt(delayHeader, 10) || 0;
  }

  const stepMatch = req.path.match(/\/api\/applications\/[^/]+\/step\/(\d+)/);
  const currentStep = stepMatch ? parseInt(stepMatch[1], 10) : 0;

  if (errorStepHeader && currentStep === parseInt(errorStepHeader as string, 10)) {
    res.status(500).json({
      error: 'Simulated HTTP 500 Transient Internal Server Error',
      message: `Chaos injection: transient HTTP 500 error on step ${currentStep}`
    });
    return;
  }

  if (chaosState.forceServerErrorSteps.includes(currentStep)) {
    // Remove it after 1 trigger to simulate transient failure
    chaosState.forceServerErrorSteps = chaosState.forceServerErrorSteps.filter(s => s !== currentStep);
    res.status(500).json({
      error: 'Simulated HTTP 500 Transient Internal Server Error',
      message: `Chaos injection: transient HTTP 500 error triggered for step ${currentStep}`
    });
    return;
  }

  if (delay > 0) {
    setTimeout(next, delay);
  } else {
    next();
  }
}
