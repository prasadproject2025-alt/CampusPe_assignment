export const ripplingSelectors = {
  form: 'form',
  jobHeading: 'h1, h2',
  applyNow: 'button',
  submit: 'form button[type="submit"][data-testid="Apply"], form button[type="submit"]',
  resume: 'input[data-testid="input-resume"][type="file"]',
  field: '[data-testid="field"]',
  recaptchaChallenge: 'iframe[src*="recaptcha"], iframe[title*="recaptcha" i], iframe[src*="turnstile"], iframe[src*="challenge"], iframe[title*="challenge" i]',
} as const
