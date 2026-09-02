export const greenhouseSelectors = {
  form: '#application-form',
  jobHeading: 'main h1',
  applicationHeading: 'h2',
  submit: '#application-form button[type="submit"]',
  resume: '#resume',
  coverLetter: '#cover_letter',
  recaptchaChallenge: 'iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]',
} as const
