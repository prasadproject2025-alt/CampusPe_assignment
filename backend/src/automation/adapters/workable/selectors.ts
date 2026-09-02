export const workableSelectors = {
  form: 'form',
  submit: 'button[data-ui="apply-button"][type="submit"]',
  resume: 'input[data-ui="resume"][type="file"]',
  resumeDropzone: '[data-role="dropzone"]',
  phone: 'input[name="phone"]',
  phoneCountryButton: '.iti__selected-flag[role="combobox"]',
  phoneCountryOptions: '.iti__country-list [data-dial-code]',
  addressOptions: '[role="listbox"] [role="option"], [data-ui="address"] + * [role="option"]',
  captchaChallenge: [
    'iframe[src*="hcaptcha.com"]',
    'iframe[src*="recaptcha/api2/bframe"]',
    'iframe[src*="recaptcha/enterprise/bframe"]',
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[title*="Cloudflare security challenge"]',
    '.cf-turnstile iframe',
  ].join(', '),
} as const
