// CampusPe In-Browser Auto-Apply Content Script
(function () {
  console.log('[CampusPe Extension] In-browser auto-apply assistant loaded.')

  // Default candidate profile (customizable or pulled from CampusPe API)
  const defaultProfile = {
    name: 'Subbu Student',
    email: 'student@example.com',
    phone: '+919876543210',
    linkedin: 'https://linkedin.com/in/student',
    github: 'https://github.com/student',
    portfolio: 'https://student-portfolio.dev',
  }

  function setNativeValue(element, value) {
    if (!element || value === undefined || value === null) return false

    element.focus()

    // For standard HTML inputs and React/Vue synthetic events
    const prototype = Object.getPrototypeOf(element)
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')

    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value)
    } else {
      element.value = value
    }

    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.blur()
    return true
  }

  function fillJobForm(profile) {
    const data = profile || defaultProfile
    let filledCount = 0

    // 1. Full Name / First Name / Last Name
    const nameSelectors = [
      'input[name="_systemfield_name"]',
      'input[name*="name" i]',
      'input[id*="name" i]',
      'input[autocomplete="name"]',
      'input[placeholder*="full name" i]',
      'input[placeholder*="name" i]',
    ]
    for (const selector of nameSelectors) {
      const el = document.querySelector(selector)
      if (el && !el.value) {
        if (setNativeValue(el, data.name)) {
          filledCount++
          break
        }
      }
    }

    // 2. Email Address
    const emailSelectors = [
      'input[name="_systemfield_email"]',
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[autocomplete="email"]',
    ]
    for (const selector of emailSelectors) {
      const el = document.querySelector(selector)
      if (el && !el.value) {
        if (setNativeValue(el, data.email)) {
          filledCount++
          break
        }
      }
    }

    // 3. Phone Number
    const phoneSelectors = [
      'input[name="_systemfield_phone"]',
      'input[type="tel"]',
      'input[name*="phone" i]',
      'input[id*="phone" i]',
      'input[autocomplete="tel"]',
    ]
    for (const selector of phoneSelectors) {
      const el = document.querySelector(selector)
      if (el && !el.value) {
        if (setNativeValue(el, data.phone)) {
          filledCount++
          break
        }
      }
    }

    // 4. Social / Portfolio Links
    const allInputs = document.querySelectorAll('input[type="text"], input[type="url"]')
    allInputs.forEach((input) => {
      const identifier = (
        (input.name || '') +
        ' ' +
        (input.id || '') +
        ' ' +
        (input.placeholder || '') +
        ' ' +
        (input.labels?.[0]?.innerText || '')
      ).toLowerCase()

      if (identifier.includes('linkedin') && !input.value) {
        if (setNativeValue(input, data.linkedin)) filledCount++
      } else if (identifier.includes('github') && !input.value) {
        if (setNativeValue(input, data.github)) filledCount++
      } else if ((identifier.includes('portfolio') || identifier.includes('website')) && !input.value) {
        if (setNativeValue(input, data.portfolio)) filledCount++
      }
    })

    return filledCount
  }

  async function submitJobForm() {
    const submitSelectors = [
      'button[data-testid*="submit" i]',
      'button[type="submit"]',
      'input[type="submit"]',
    ]

    let submitBtn = null
    for (const sel of submitSelectors) {
      const btn = document.querySelector(sel)
      if (btn) {
        submitBtn = btn
        break
      }
    }

    if (!submitBtn) {
      const buttons = Array.from(document.querySelectorAll('button'))
      submitBtn = buttons.find((b) => /submit application|submit/i.test(b.textContent || ''))
    }

    if (submitBtn) {
      submitBtn.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await new Promise((r) => setTimeout(r, 600))
      submitBtn.click()
      return { ok: true, message: 'Application submitted directly in your browser!' }
    } else {
      return { ok: false, message: 'Form filled. Please verify required files and click Submit.' }
    }
  }

  // Floating Action Widget inside the employer's page
  function injectFloatingWidget() {
    if (document.getElementById('campuspe-floating-widget')) return

    const widget = document.createElement('div')
    widget.id = 'campuspe-floating-widget'
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: #0f172a;
      border: 1px solid #38bdf8;
      border-radius: 12px;
      padding: 12px 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: system-ui, -apple-system, sans-serif;
    `

    widget.innerHTML = `
      <div style="color: #f8fafc; font-size: 13px; font-weight: 600;">
        ⚡ CampusPe Auto-Apply
      </div>
      <button id="campuspe-btn-fill" style="
        background: #0284c7;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      ">Fill Form</button>
      <button id="campuspe-btn-submit" style="
        background: #16a34a;
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      ">Fill & Submit</button>
    `

    document.body.appendChild(widget)

    document.getElementById('campuspe-btn-fill').addEventListener('click', () => {
      const count = fillJobForm()
      alert(`✅ CampusPe populated ${count} fields!`)
    })

    document.getElementById('campuspe-btn-submit').addEventListener('click', async () => {
      fillJobForm()
      await new Promise((r) => setTimeout(r, 800))
      const res = await submitJobForm()
      alert(res.message)
    })
  }

  // Inject widget after page loads
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(injectFloatingWidget, 1000)
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(injectFloatingWidget, 1000))
  }

  // Listener for extension popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'CAMPUSPE_APPLY') {
        const filled = fillJobForm(request.profile)
        if (request.autoSubmit) {
          setTimeout(async () => {
            const result = await submitJobForm()
            sendResponse({ message: `Filled ${filled} fields. ${result.message}` })
          }, 1000)
          return true
        } else {
          sendResponse({ message: `Successfully filled ${filled} fields.` })
        }
      }
    })
  }
})()
