export const recruiteeSelectors = {
  form: '#offer-application-form',
  submit: '[data-testid="submit-application-form-button"]',
  resume: 'input[type="file"][name="candidate.cv"]',
  phoneCountry: 'button[id^="country-select-input-candidate.phone"]',
  captchaChallenge: 'iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"], .cf-turnstile iframe',
} as const
