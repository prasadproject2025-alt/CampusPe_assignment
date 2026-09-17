document.getElementById('btnFill').addEventListener('click', () => {
  executeAction(false)
})

document.getElementById('btnFillSubmit').addEventListener('click', () => {
  executeAction(true)
})

async function executeAction(autoSubmit) {
  const statusEl = document.getElementById('status')
  statusEl.textContent = 'Processing...'

  const profile = {
    name: document.getElementById('name').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    linkedin: document.getElementById('linkedin').value,
    github: document.getElementById('github').value,
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id) {
    statusEl.textContent = 'No active tab found.'
    return
  }

  chrome.tabs.sendMessage(
    tab.id,
    { action: 'CAMPUSPE_APPLY', profile, autoSubmit },
    (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = 'Error: ' + chrome.runtime.lastError.message
      } else if (response) {
        statusEl.textContent = response.message || 'Action executed.'
      }
    }
  )
}
