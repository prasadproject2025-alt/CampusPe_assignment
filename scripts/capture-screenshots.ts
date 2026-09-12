import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

async function captureScreenshots() {
  const screenshotsDir = path.join(__dirname, '..', 'artifacts', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('domcontentloaded');

  // 1. Step 1: Personal Info
  await page.screenshot({ path: path.join(screenshotsDir, 'step1_personal_info.png') });
  console.log('Captured step 1');

  await page.fill('#fullName', 'Alex Rivera');
  await page.fill('#email', 'alex.rivera@example.com');
  await page.fill('#phone', '+1 555-0199');
  await page.fill('#location', 'San Francisco, CA');
  await page.fill('#linkedIn', 'https://linkedin.com/in/alexrivera-eng');
  await page.click('#btn-step-1-next');
  await page.waitForSelector('#step-pane-2:not(.hidden)', { timeout: 5000 });

  // 2. Step 2: Education
  await page.screenshot({ path: path.join(screenshotsDir, 'step2_education.png') });
  console.log('Captured step 2');

  await page.selectOption('#degree', { index: 1 });
  await page.fill('#institution', 'Stanford University');
  await page.fill('#fieldOfStudy', 'Computer Science');
  await page.selectOption('#graduationYear', '2024');
  await page.fill('#gpa', '3.9');
  await page.click('#btn-step-2-next');
  await page.waitForSelector('#step-pane-3:not(.hidden)', { timeout: 5000 });

  // 3. Step 3: Experience
  await page.screenshot({ path: path.join(screenshotsDir, 'step3_experience.png') });
  console.log('Captured step 3');

  await page.fill('#currentCompany', 'TechNova Solutions');
  await page.fill('#jobTitle', 'Full Stack Software Engineer');
  await page.selectOption('#yearsOfExperience', { index: 1 });
  await page.fill('#techStack', 'TypeScript, Playwright, Node.js, Express, React');
  await page.fill('#responsibilities', 'Lead developer for automation engine and resilience architecture.');
  await page.click('#btn-step-3-next');
  await page.waitForSelector('#step-pane-4:not(.hidden)', { timeout: 5000 });

  // 4. Step 4: Resume Upload
  const resumePath = path.join(__dirname, '..', 'data', 'Alex_Rivera_Resume.pdf');
  if (fs.existsSync(resumePath)) {
    const fileInput = await page.$('#resumeFile');
    if (fileInput) {
      await fileInput.setInputFiles(resumePath);
      await fileInput.dispatchEvent('change');
      await page.waitForTimeout(500);
    }
  }
  await page.screenshot({ path: path.join(screenshotsDir, 'step4_resume_upload.png') });
  console.log('Captured step 4');

  await page.click('#btn-step-4-next');
  await page.waitForSelector('#step-pane-5:not(.hidden)', { timeout: 5000 });

  // 5. Step 5: Review
  await page.check('#consentCheckbox');
  await page.screenshot({ path: path.join(screenshotsDir, 'step5_review.png') });
  console.log('Captured step 5');

  await page.click('#btn-step-5-submit');
  await page.waitForSelector('#step-pane-6:not(.hidden)', { timeout: 5000 });

  // 6. Step 6: Confirmation
  await page.screenshot({ path: path.join(screenshotsDir, 'step6_confirmation.png') });
  console.log('Captured step 6');

  await browser.close();
  console.log('All screenshots captured successfully!');
}

captureScreenshots().catch(console.error);
