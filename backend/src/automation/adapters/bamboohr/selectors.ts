export const bambooHrSelectors = {
  form: '#job-application-form',
  submit: '#job-application-form button[type="submit"]',
  resume: '#job-application-form input[type="file"][aria-label="file-input"]',
  resumeId: '#job-application-form input[name="resumeFileId"]',
  captchaChallenge: 'iframe[src*="recaptcha"], iframe[title*="recaptcha" i]',
} as const
