// CampusPE Job Application Portal - Interactive Frontend
(function () {
  'use strict';

  const state = {
    currentStep: 1,
    applicationId: null,
    sessionToken: null,
    user: null,
    formData: {
      personalInfo: {},
      education: {},
      experience: {},
      resume: null
    },
    selectedResumeFile: null,
    chaosOpen: false,
    idempotencyKey: null
  };

  // DOM Elements
  const elements = {
    currentAppId: document.getElementById('current-app-id'),
    sessionBadge: document.getElementById('session-badge'),
    sessionStatusText: document.getElementById('session-status-text'),
    progressFill: document.getElementById('progress-fill'),
    alertBox: document.getElementById('alert-box'),
    alertIcon: document.getElementById('alert-icon'),
    alertMessage: document.getElementById('alert-message'),
    alertClose: document.getElementById('alert-close'),
    uploadDropzone: document.getElementById('upload-dropzone'),
    resumeFile: document.getElementById('resumeFile'),
    fileInfoCard: document.getElementById('file-info-card'),
    fileDisplayName: document.getElementById('file-display-name'),
    fileDisplaySize: document.getElementById('file-display-size'),
    removeFileBtn: document.getElementById('remove-file-btn'),
    sessionModal: document.getElementById('session-modal'),
    reauthEmail: document.getElementById('reauth-email'),
    btnReauthSubmit: document.getElementById('btn-reauth-submit'),
    toggleChaosBtn: document.getElementById('toggle-chaos-btn'),
    chaosDrawer: document.getElementById('chaos-drawer'),
    chaosCloseBtn: document.getElementById('chaos-close-btn'),
    chaosStatusIndicator: document.getElementById('chaos-status-indicator'),
    btnChaosExpire: document.getElementById('btn-chaos-expire-session'),
    btnChaos500: document.getElementById('btn-chaos-simulate-500'),
    btnChaosLatency: document.getElementById('btn-chaos-add-latency'),
    btnChaosReset: document.getElementById('btn-chaos-reset'),
    btnSubmitApp: document.getElementById('btn-submit-application')
  };

  // Safe API Fetch Wrapper that intercepts 401 Session Expiry
  async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (state.sessionToken) {
      options.headers['Authorization'] = `Bearer ${state.sessionToken}`;
    }
    options.credentials = 'include';

    try {
      const response = await fetch(url, options);

      // Intercept 401 Session Expiry
      if (response.status === 401) {
        handleSessionExpired();
        throw new Error('SESSION_EXPIRED');
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const errorMsg = data.error || data.message || `Request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      return data;
    } catch (err) {
      if (err.message === 'SESSION_EXPIRED') throw err;
      throw err;
    }
  }

  // Handle Session Expiry Modal Popup
  function handleSessionExpired() {
    updateSessionUI(false);
    elements.reauthEmail.value = state.formData.personalInfo.email || (state.user && state.user.email) || 'alex.rivera@example.com';
    elements.sessionModal.classList.remove('hidden');
    showAlert('Your session has expired. Please re-authenticate to preserve and continue your application.', 'warning');
  }

  // Ensure application draft ID and state are loaded from server
  async function ensureApplicationDraftLoaded() {
    if (!state.applicationId) {
      try {
        const draftRes = await apiFetch('/api/applications/current');
        if (draftRes && draftRes.draft) {
          state.applicationId = draftRes.draft.applicationId;
          elements.currentAppId.textContent = state.applicationId;
          if (draftRes.draft.personalInfo) state.formData.personalInfo = draftRes.draft.personalInfo;
          if (draftRes.draft.education) state.formData.education = draftRes.draft.education;
          if (draftRes.draft.experience) state.formData.experience = draftRes.draft.experience;
          if (draftRes.draft.resume) state.formData.resume = draftRes.draft.resume;
        }
      } catch (err) {
        // Not authenticated yet
      }
    }
    return state.applicationId;
  }

  // Re-authenticate silently or via modal
  async function reauthenticate(email) {
    try {
      const payload = {
        email: email || elements.reauthEmail.value,
        name: state.formData.personalInfo.fullName || 'Candidate'
      };

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        state.sessionToken = data.token;
        state.user = data.user;
        updateSessionUI(true, data.user.email);
        elements.sessionModal.classList.add('hidden');
        await ensureApplicationDraftLoaded();
        showAlert('Re-authenticated successfully! You can resume from your current step.', 'success');
        return true;
      }
    } catch (err) {
      showAlert('Re-authentication failed: ' + err.message, 'error');
      return false;
    }
  }

  // Session UI Indicator Update
  function updateSessionUI(isConnected, email) {
    if (isConnected) {
      elements.sessionBadge.className = 'session-badge status-connected';
      elements.sessionStatusText.textContent = `Active (${email || 'Candidate'})`;
    } else {
      elements.sessionBadge.className = 'session-badge status-disconnected';
      elements.sessionStatusText.textContent = 'Session Expired';
    }
  }

  // Alert Banner Helper
  function showAlert(msg, type = 'error') {
    elements.alertMessage.textContent = msg;
    elements.alertBox.className = `alert-box alert-${type}`;
    elements.alertIcon.textContent = type === 'error' ? '❌' : (type === 'success' ? '✅' : '⚠️');
    elements.alertBox.classList.remove('hidden');
    setTimeout(() => {
      // Auto-hide success after 4s
      if (type === 'success') elements.alertBox.classList.add('hidden');
    }, 4000);
  }

  elements.alertClose.addEventListener('click', () => {
    elements.alertBox.classList.add('hidden');
  });

  // Navigation & Stepper Logic
  function goToStep(step) {
    state.currentStep = step;

    // Update Panes
    for (let i = 1; i <= 6; i++) {
      const pane = document.getElementById(`step-pane-${i}`);
      if (pane) {
        if (i === step) pane.classList.remove('hidden');
        else pane.classList.add('hidden');
      }

      // Update Nav Indicators
      const navItem = document.getElementById(`step-nav-${i}`);
      const line = document.getElementById(`line-${i - 1}`);

      if (navItem) {
        navItem.classList.remove('active', 'completed');
        if (i === step) navItem.classList.add('active');
        else if (i < step) navItem.classList.add('completed');
      }

      if (line) {
        if (i <= step) line.classList.add('completed');
        else line.classList.remove('completed');
      }
    }

    // Update Progress Bar
    const percent = Math.round(((step - 1) / 5) * 100);
    elements.progressFill.style.width = `${Math.max(16, percent)}%`;

    // Populate review screen when reaching step 5
    if (step === 5) {
      hydrateReviewScreen();
    }

    window.scrollTo({ top: 120, behavior: 'smooth' });
  }

  // Hydrate Review Screen with Draft State
  async function hydrateReviewScreen() {
    if (!state.formData.personalInfo || !state.formData.personalInfo.email) {
      await ensureApplicationDraftLoaded();
    }
    const p = state.formData.personalInfo || {};
    document.getElementById('rev-name').textContent = p.fullName || '-';
    document.getElementById('rev-email').textContent = p.email || '-';
    document.getElementById('rev-phone').textContent = p.phone || '-';
    document.getElementById('rev-location').textContent = p.location || '-';
    document.getElementById('rev-linkedin').textContent = p.linkedIn || 'Not provided';
    document.getElementById('rev-portfolio').textContent = p.portfolio || 'Not provided';

    const e = state.formData.education || {};
    document.getElementById('rev-degree').textContent = e.degree || '-';
    document.getElementById('rev-institution').textContent = e.institution || '-';
    document.getElementById('rev-major').textContent = e.fieldOfStudy || '-';
    document.getElementById('rev-year').textContent = e.graduationYear || '-';
    document.getElementById('rev-gpa').textContent = e.gpa || 'N/A';

    const x = state.formData.experience || {};
    document.getElementById('rev-company').textContent = x.currentCompany || '-';
    document.getElementById('rev-role').textContent = x.jobTitle || '-';
    document.getElementById('rev-years').textContent = (x.yearsOfExperience ? x.yearsOfExperience + ' years' : '-');
    document.getElementById('rev-tech').textContent = x.techStack || 'N/A';

    const r = state.formData.resume || {};
    document.getElementById('rev-resume-file').textContent = r.originalName || (state.selectedResumeFile && state.selectedResumeFile.name) || 'resume.pdf';
  }

  // Clear Validation Errors
  function clearErrors() {
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
  }

  function setError(fieldId, message) {
    const field = document.getElementById(fieldId);
    const errEl = document.getElementById(`err-${fieldId}`);
    if (field) field.classList.add('is-invalid');
    if (errEl) errEl.textContent = message;
  }

  // Step 1: Personal Info Form Submit
  document.getElementById('form-step-1').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearErrors();

    const fullName = document.getElementById('fullName').value.trim();
    const email = document.getElementById('email').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const location = document.getElementById('location').value.trim();
    const linkedIn = document.getElementById('linkedIn').value.trim();
    const portfolio = document.getElementById('portfolio').value.trim();

    let hasError = false;
    if (!fullName) { setError('fullName', 'Full name is required'); hasError = true; }
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) { setError('email', 'Valid email address is required'); hasError = true; }
    if (!phone) { setError('phone', 'Phone number is required'); hasError = true; }

    if (hasError) return;

    state.formData.personalInfo = { fullName, email, phone, location, linkedIn, portfolio };

    try {
      // 1. Ensure authenticated session
      if (!state.sessionToken) {
        const loginRes = await apiFetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name: fullName })
        });
        state.sessionToken = loginRes.token;
        state.user = loginRes.user;
        updateSessionUI(true, email);
      }

      // 2. Fetch or create draft
      const draftRes = await apiFetch('/api/applications/current');
      state.applicationId = draftRes.draft.applicationId;
      elements.currentAppId.textContent = state.applicationId;

      // 3. Save Step 1
      await apiFetch(`/api/applications/${state.applicationId}/step/1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.formData.personalInfo)
      });

      goToStep(2);
    } catch (err) {
      if (err.message !== 'SESSION_EXPIRED') showAlert(err.message, 'error');
    }
  });

  // Step 2: Education Form Submit
  document.getElementById('form-step-2').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearErrors();

    const degree = document.getElementById('degree').value;
    const institution = document.getElementById('institution').value.trim();
    const fieldOfStudy = document.getElementById('fieldOfStudy').value.trim();
    const graduationYear = document.getElementById('graduationYear').value;
    const gpa = document.getElementById('gpa').value.trim();

    let hasError = false;
    if (!degree) { setError('degree', 'Please select your degree'); hasError = true; }
    if (!institution) { setError('institution', 'Institution name is required'); hasError = true; }
    if (!graduationYear) { setError('graduationYear', 'Graduation year is required'); hasError = true; }

    if (hasError) return;

    state.formData.education = { degree, institution, fieldOfStudy, graduationYear, gpa };

    try {
      await ensureApplicationDraftLoaded();
      await apiFetch(`/api/applications/${state.applicationId}/step/2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.formData.education)
      });
      goToStep(3);
    } catch (err) {
      if (err.message !== 'SESSION_EXPIRED') showAlert(err.message, 'error');
    }
  });

  // Step 3: Experience Form Submit
  document.getElementById('form-step-3').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearErrors();

    const currentCompany = document.getElementById('currentCompany').value.trim();
    const jobTitle = document.getElementById('jobTitle').value.trim();
    const yearsOfExperience = document.getElementById('yearsOfExperience').value;
    const techStack = document.getElementById('techStack').value.trim();
    const responsibilities = document.getElementById('responsibilities').value.trim();

    let hasError = false;
    if (!currentCompany) { setError('currentCompany', 'Company is required'); hasError = true; }
    if (!jobTitle) { setError('jobTitle', 'Job title is required'); hasError = true; }
    if (!yearsOfExperience) { setError('yearsOfExperience', 'Please select years of experience'); hasError = true; }

    if (hasError) return;

    state.formData.experience = { currentCompany, jobTitle, yearsOfExperience, techStack, responsibilities };

    try {
      await ensureApplicationDraftLoaded();
      await apiFetch(`/api/applications/${state.applicationId}/step/3`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.formData.experience)
      });
      goToStep(4);
    } catch (err) {
      if (err.message !== 'SESSION_EXPIRED') showAlert(err.message, 'error');
    }
  });

  // Step 4: Resume Drag & Drop and File Selection
  function handleFileSelection(file) {
    if (!file) return;
    state.selectedResumeFile = file;
    elements.fileDisplayName.textContent = file.name;
    elements.fileDisplaySize.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    elements.fileInfoCard.classList.remove('hidden');
    document.getElementById('err-resume').textContent = '';
  }

  elements.resumeFile.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelection(e.target.files[0]);
    }
  });

  elements.removeFileBtn.addEventListener('click', () => {
    state.selectedResumeFile = null;
    elements.resumeFile.value = '';
    elements.fileInfoCard.classList.add('hidden');
  });

  elements.uploadDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadDropzone.classList.add('dragover');
  });

  elements.uploadDropzone.addEventListener('dragleave', () => {
    elements.uploadDropzone.classList.remove('dragover');
  });

  elements.uploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  });

  // Step 4: Resume Form Submit
  document.getElementById('form-step-4').addEventListener('submit', async function (e) {
    e.preventDefault();
    const errEl = document.getElementById('err-resume');
    errEl.textContent = '';

    if (!state.selectedResumeFile && !state.formData.resume) {
      errEl.textContent = 'Please select a resume file to upload.';
      return;
    }

    try {
      await ensureApplicationDraftLoaded();
      if (state.selectedResumeFile) {
        const formData = new FormData();
        formData.append('resume', state.selectedResumeFile);

        const res = await apiFetch(`/api/applications/${state.applicationId}/resume`, {
          method: 'POST',
          body: formData
        });

        state.formData.resume = res.resume;
      }

      goToStep(5);
    } catch (err) {
      if (err.message !== 'SESSION_EXPIRED') showAlert(err.message, 'error');
    }
  });

  // Generate or reuse Idempotency Key for Step 6 Submit
  function getOrGenerateIdempotencyKey() {
    if (!state.idempotencyKey) {
      state.idempotencyKey = `idemp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    return state.idempotencyKey;
  }

  // Step 5: Final Submission with Idempotency Key Guard
  elements.btnSubmitApp.addEventListener('click', async function () {
    elements.btnSubmitApp.disabled = true;
    elements.btnSubmitApp.textContent = 'Submitting Application...';

    const idempotencyKey = getOrGenerateIdempotencyKey();

    try {
      await ensureApplicationDraftLoaded();
      const res = await apiFetch(`/api/applications/${state.applicationId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({ idempotencyKey })
      });

      // Show confirmation screen
      document.getElementById('confirm-app-id').textContent = res.applicationId;
      document.getElementById('confirm-name').textContent = state.formData.personalInfo.fullName || 'Candidate';
      document.getElementById('confirm-email').textContent = state.formData.personalInfo.email || (state.user && state.user.email);
      document.getElementById('confirm-timestamp').textContent = new Date(res.submittedAt || Date.now()).toLocaleString();

      const dupWarning = document.getElementById('duplicate-warning-banner');
      if (res.isDuplicate) {
        dupWarning.classList.remove('hidden');
      } else {
        dupWarning.classList.add('hidden');
      }

      goToStep(6);
    } catch (err) {
      elements.btnSubmitApp.disabled = false;
      elements.btnSubmitApp.textContent = 'Confirm & Submit Application 🚀';
      if (err.message !== 'SESSION_EXPIRED') showAlert(err.message, 'error');
    }
  });

  // Re-auth button in modal
  elements.btnReauthSubmit.addEventListener('click', async () => {
    await reauthenticate();
  });

  // Chaos Drawer Interactions
  elements.toggleChaosBtn.addEventListener('click', () => {
    state.chaosOpen = !state.chaosOpen;
    elements.chaosDrawer.classList.toggle('open', state.chaosOpen);
  });

  elements.chaosCloseBtn.addEventListener('click', () => {
    state.chaosOpen = false;
    elements.chaosDrawer.classList.remove('open');
  });

  // Chaos: Expire Session
  elements.btnChaosExpire.addEventListener('click', async () => {
    try {
      await fetch('/api/chaos/expire-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: state.sessionToken })
      });
      elements.chaosStatusIndicator.innerHTML = 'Chaos State: <span style="color:#ef4444">Session Expired (401)</span>';
      showAlert('⚡ Chaos Triggered: Session token has been forcibly invalidated!', 'warning');
      updateSessionUI(false);
    } catch (err) {
      showAlert('Chaos trigger failed: ' + err.message, 'error');
    }
  });

  // Chaos: Simulate 500 Error
  elements.btnChaos500.addEventListener('click', async () => {
    try {
      await fetch('/api/chaos/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceServerErrorSteps: [state.currentStep] })
      });
      elements.chaosStatusIndicator.innerHTML = `Chaos State: <span style="color:#f59e0b">500 on Step ${state.currentStep}</span>`;
      showAlert(`⚡ Chaos Triggered: Step ${state.currentStep} will return HTTP 500 on next submit!`, 'warning');
    } catch (err) {
      showAlert('Chaos trigger failed: ' + err.message, 'error');
    }
  });

  // Chaos: Inject Latency
  elements.btnChaosLatency.addEventListener('click', async () => {
    try {
      await fetch('/api/chaos/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ networkLatencyMs: 3000 })
      });
      elements.chaosStatusIndicator.innerHTML = 'Chaos State: <span style="color:#3b82f6">3000ms Latency</span>';
      showAlert('⚡ Chaos Triggered: 3000ms delay injected on all requests!', 'warning');
    } catch (err) {
      showAlert('Chaos trigger failed: ' + err.message, 'error');
    }
  });

  // Chaos: Reset
  elements.btnChaosReset.addEventListener('click', async () => {
    try {
      await fetch('/api/chaos/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetChaos: true })
      });
      elements.chaosStatusIndicator.innerHTML = 'Chaos State: <span>Normal</span>';
      showAlert('Chaos settings reset to default.', 'success');
    } catch (err) {
      showAlert('Chaos reset failed: ' + err.message, 'error');
    }
  });

  // Reset for new application
  function resetForNewApplication() {
    window.location.reload();
  }

  // Initialize Session check on load
  async function init() {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated) {
          state.user = data.user;
          updateSessionUI(true, data.user.email);
          await ensureApplicationDraftLoaded();
        }
      }
    } catch (e) {
      // Not logged in yet
    }
  }

  init();

  // Expose methods for button onclick attributes
  window.app = {
    goToStep,
    reauthenticate,
    resetForNewApplication
  };
})();
