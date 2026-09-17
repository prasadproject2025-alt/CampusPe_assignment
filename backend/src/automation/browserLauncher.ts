import { AsyncLocalStorage } from 'node:async_hooks'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { automationViewport } from './preview.js'

export type BrowserPermit = 'extract' | 'submit' | 'resume-review' | 'test'

const launchPermit = new AsyncLocalStorage<BrowserPermit>()
let browserLaunchCount = 0
let testLauncher: (() => Promise<{ browser: Browser; context: BrowserContext }>) | null = null

export function getBrowserLaunchCount() { return browserLaunchCount }
export function resetBrowserLaunchCount() { browserLaunchCount = 0 }
export function setBrowserLauncherForTests(launcher: (() => Promise<{ browser: Browser; context: BrowserContext }>) | null) {
  testLauncher = launcher
}

export function runWithBrowserPermit<T>(permit: BrowserPermit, work: () => T): T {
  return launchPermit.run(permit, work)
}

export function currentBrowserPermit() {
  return launchPermit.getStore() || null
}

// ---------------------------------------------------------------------------
// Modern User-Agent — keep this up to date with the latest stable Chrome
// ---------------------------------------------------------------------------
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

// ---------------------------------------------------------------------------
// Comprehensive stealth init script
// ---------------------------------------------------------------------------
const STEALTH_INIT_SCRIPT = `(() => {
  'use strict';
  try {
    // ---- Native toString spoofing helper -----------------------------------
    const nativeToStrings = new WeakMap();
    const originalToString = Function.prototype.toString;
    Function.prototype.toString = function() {
      if (nativeToStrings.has(this)) return nativeToStrings.get(this);
      return originalToString.apply(this, arguments);
    };
    function markNative(fn, name) {
      nativeToStrings.set(fn, 'function ' + (name || fn.name || '') + '() { [native code] }');
      return fn;
    }

    // ---- navigator.webdriver ------------------------------------------------
    if ('webdriver' in Navigator.prototype) {
      delete Navigator.prototype.webdriver;
    }
    Object.defineProperty(navigator, 'webdriver', {
      get: markNative(() => undefined, 'get webdriver'),
      configurable: true,
      enumerable: true,
    });

    // ---- navigator.languages ------------------------------------------------
    Object.defineProperty(navigator, 'languages', {
      get: markNative(() => ['en-US', 'en'], 'get languages'),
      configurable: true,
    });

    // ---- navigator.platform -------------------------------------------------
    Object.defineProperty(navigator, 'platform', {
      get: markNative(() => 'Win32', 'get platform'),
      configurable: true,
    });

    // ---- navigator.hardwareConcurrency --------------------------------------
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: markNative(() => 8, 'get hardwareConcurrency'),
      configurable: true,
    });

    // ---- navigator.deviceMemory ---------------------------------------------
    Object.defineProperty(navigator, 'deviceMemory', {
      get: markNative(() => 8, 'get deviceMemory'),
      configurable: true,
    });

    // ---- navigator.maxTouchPoints -------------------------------------------
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: markNative(() => 0, 'get maxTouchPoints'),
      configurable: true,
    });

    // ---- navigator.plugins --------------------------------------------------
    const makePlugin = (name, filename, description) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { get: markNative(() => name, 'get name'), enumerable: true },
        filename: { get: markNative(() => filename, 'get filename'), enumerable: true },
        description: { get: markNative(() => description, 'get description'), enumerable: true },
        length: { get: markNative(() => 1, 'get length'), enumerable: true },
      });
      return plugin;
    };
    const pluginData = [
      ['PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'],
      ['Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format'],
      ['Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'],
      ['Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'],
      ['WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'],
    ];
    const fakePlugins = pluginData.map(args => makePlugin(...args));
    Object.defineProperty(navigator, 'plugins', {
      get: markNative(() => {
        const list = Object.create(PluginArray.prototype);
        fakePlugins.forEach((p, i) => { list[i] = p; });
        Object.defineProperty(list, 'length', { get: markNative(() => fakePlugins.length, 'get length') });
        list.item = markNative((i) => fakePlugins[i] || null, 'item');
        list.namedItem = markNative((n) => fakePlugins.find(p => p.name === n) || null, 'namedItem');
        list.refresh = markNative(() => {}, 'refresh');
        return list;
      }, 'get plugins'),
      configurable: true,
    });

    // ---- navigator.mimeTypes ------------------------------------------------
    Object.defineProperty(navigator, 'mimeTypes', {
      get: markNative(() => {
        const list = Object.create(MimeTypeArray.prototype);
        Object.defineProperty(list, 'length', { get: markNative(() => 2, 'get length') });
        list.item = markNative(() => null, 'item');
        list.namedItem = markNative(() => null, 'namedItem');
        return list;
      }, 'get mimeTypes'),
      configurable: true,
    });

    // ---- navigator.connection -----------------------------------------------
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: markNative(() => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
        }), 'get connection'),
        configurable: true,
      });
    }

    // ---- window.chrome ------------------------------------------------------
    if (!window.chrome || !window.chrome.runtime || !window.chrome.runtime.connect) {
      window.chrome = {
        app: {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails: markNative(function() { return null; }, 'getDetails'),
          getIsInstalled: markNative(function() { return false; }, 'getIsInstalled'),
          installState: markNative(function(cb) { if (cb) cb('not_installed'); }, 'installState'),
          runningState: markNative(function() { return 'cannot_run'; }, 'runningState'),
        },
        runtime: {
          OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
          OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
          PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
          PlatformOs: { ANDROID: 'android', CROS: 'cros', FUCHSIA: 'fuchsia', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
          connect: markNative(function() { return { onDisconnect: { addListener: function() {} }, onMessage: { addListener: function() {} }, postMessage: function() {}, disconnect: function() {} }; }, 'connect'),
          sendMessage: markNative(function() {}, 'sendMessage'),
          id: undefined,
        },
        csi: markNative(function() { return { onloadT: Date.now(), pageT: Date.now() + Math.random() * 100, startE: Date.now() - Math.random() * 2000, tran: 15 }; }, 'csi'),
        loadTimes: markNative(function() {
          return {
            commitLoadTime: Date.now() / 1000 - Math.random() * 2,
            connectionInfo: 'h2',
            finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
            finishLoadTime: Date.now() / 1000 - Math.random() * 0.5,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: Date.now() / 1000 - Math.random() * 1.5,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'h2',
            requestTime: Date.now() / 1000 - Math.random() * 3,
            startLoadTime: Date.now() / 1000 - Math.random() * 2.5,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: true,
            wasNpnNegotiated: true,
          };
        }, 'loadTimes'),
      };
    }

    // ---- permissions.query --------------------------------------------------
    if (window.navigator.permissions && window.navigator.permissions.query) {
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = markNative((parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null, addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; } });
        }
        if (parameters.name === 'midi' || parameters.name === 'camera' || parameters.name === 'microphone' || parameters.name === 'speaker' || parameters.name === 'device-info' || parameters.name === 'background-fetch' || parameters.name === 'background-sync' || parameters.name === 'bluetooth' || parameters.name === 'persistent-storage' || parameters.name === 'ambient-light-sensor' || parameters.name === 'accelerometer' || parameters.name === 'gyroscope' || parameters.name === 'magnetometer' || parameters.name === 'clipboard-read' || parameters.name === 'clipboard-write' || parameters.name === 'display-capture' || parameters.name === 'nfc') {
          return Promise.resolve({ state: 'prompt', onchange: null, addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; } });
        }
        return originalQuery(parameters).catch(() =>
          Promise.resolve({ state: 'prompt', onchange: null, addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; } })
        );
      }, 'query');
    }

    // ---- WebGL renderer spoofing --------------------------------------------
    const getParameterProto = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = markNative(function(parameter) {
      if (parameter === 0x1F01) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)';
      if (parameter === 0x1F00) return 'Google Inc. (Intel)';
      if (parameter === 0x9246) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)';
      if (parameter === 0x9245) return 'Google Inc. (Intel)';
      return getParameterProto.apply(this, arguments);
    }, 'getParameter');

    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2Proto = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = markNative(function(parameter) {
        if (parameter === 0x1F01) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)';
        if (parameter === 0x1F00) return 'Google Inc. (Intel)';
        if (parameter === 0x9246) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)';
        if (parameter === 0x9245) return 'Google Inc. (Intel)';
        return getParameter2Proto.apply(this, arguments);
      }, 'getParameter');
    }

    // ---- window dimensions --------------------------------------------------
    if (window.outerWidth === 0) Object.defineProperty(window, 'outerWidth', { get: markNative(() => window.innerWidth, 'get outerWidth'), configurable: true });
    if (window.outerHeight === 0) Object.defineProperty(window, 'outerHeight', { get: markNative(() => window.innerHeight + 85, 'get outerHeight'), configurable: true });

    // ---- screen properties --------------------------------------------------
    Object.defineProperty(screen, 'colorDepth', { get: markNative(() => 24, 'get colorDepth'), configurable: true });
    Object.defineProperty(screen, 'pixelDepth', { get: markNative(() => 24, 'get pixelDepth'), configurable: true });

    // ---- Notification constructor protection --------------------------------
    if (typeof Notification === 'undefined') {
      window.Notification = markNative(function() {}, 'Notification');
      window.Notification.permission = 'default';
      window.Notification.requestPermission = markNative(function() { return Promise.resolve('default'); }, 'requestPermission');
    }

    // ---- window.Intl consistency --------------------------------------------
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = markNative(function() {
      const result = originalResolvedOptions.apply(this, arguments);
      if (!result.locale || result.locale === '') result.locale = 'en-US';
      return result;
    }, 'resolvedOptions');

  } catch (e) {
    // Stealth patches must never throw
  }
})()`

export async function launchHeadlessAutomationBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  const permit = launchPermit.getStore()
  if (!permit) {
    throw new Error('Playwright launch blocked: browser launcher is only allowed inside a SERVER_BROWSER_AUTOMATION worker (extract or submit).')
  }
  browserLaunchCount += 1
  if (testLauncher) return testLauncher()
  let browser: Browser | undefined
  try {
    // Chrome gets Playwright's temporary profile; never attach to the user's session.
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        `--window-size=${automationViewport.width},${automationViewport.height}`,
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins',
        '--disable-infobars',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--lang=en-US,en',
        '--accept-lang=en-US,en;q=0.9',
      ],
    })
    const context = await browser.newContext({
      viewport: automationViewport,
      screen: { width: 1920, height: 1080 },
      userAgent: CHROME_USER_AGENT,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      colorScheme: 'light',
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'sec-ch-ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    })
    await context.addInitScript(STEALTH_INIT_SCRIPT)
    return { browser, context }
  } catch (error) {
    await browser?.close().catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    if (/Executable doesn't exist|executable doesn't exist|distribution ['"]chrome['"] is not found/i.test(message)) {
      throw new Error('Google Chrome is not installed in its standard location. Install Google Chrome on the backend host, then start a new application.')
    }
    throw error
  }
}
