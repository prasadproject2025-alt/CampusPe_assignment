# CampusPe Auto Apply MVP

CampusPe Auto Apply MVP is a local-first job application assistant that helps candidates fill supported ATS application forms. It maintains a reusable candidate profile, detects application fields, resolves candidate information through a layered answer system, fills supported fields in a visible Chrome window, and pauses when human input is required.

The application is designed around one principle: automate repetitive form work without silently inventing candidate facts. Profile data and previously approved answers are preferred, AI-written answers are constrained by the visible control type, and uncertain or protected questions pause for user input.

## Quick Start

### Prerequisites

- Node.js (the backend uses the built-in `node:sqlite` module)
- npm
- Google Chrome installed
- Ollama (recommended for AI-generated answers and resume analysis)

### Installation

```bash
# Install root dependencies
npm install

# Install frontend dependencies
cd frontend && npm install

# Install backend dependencies
cd ../backend && npm install

# Return to root
cd ..
```

### Start the Application

```bash
npm run dev
```

This starts:

- Frontend: `http://localhost:5173`
- Backend API: `http://127.0.0.1:3001`
- Ollama, if `ollama` is installed (used for resume analysis and drafted answers)

If port 5173 is occupied, Vite automatically selects the next free port (5174, 5175, etc.). Use the URL printed beside `WEB` in the terminal.

If Ollama is not installed, the API and web app still start. Resume analysis and AI drafts need Ollama in a separate terminal:

```bash
ollama serve
ollama pull gemma3:4b
```

Then keep `ollama serve` running and start the app:

```bash
# Terminal 1
ollama serve

# Terminal 2
cd backend && npm run dev

# Terminal 3
cd frontend && npm run dev
```

### Stop the Application

Press `Ctrl+C` in the terminal running `npm run dev`.

## Key Features

- Responsive React dashboard for desktop and mobile
- Local account and reusable application profile
- Resume upload, preview, review, job matching, and optimization suggestions
- Visible-browser application automation with human-in-the-loop control
- Pause, continue, assisted submission, and testing modes
- Three-layer answer resolution: profile, approved memory, then local AI
- Exact-option matching for dropdowns, radios, checkboxes, and searchable selects
- Application adapters for Ashby, Greenhouse, Rippling, Breezy, Lever, Workable, BambooHR, and Recruitee
- Local SQLite persistence and encryption for sensitive stored answers

## How Auto Apply Works

1. **Job URL** → Detect ATS platform
2. **Launch visible Chrome** → Open job/application page
3. **Inspect fields** → Extract application form questions
4. **Resolve answers** → Use L1 (profile), L2 (memory), or L3 (AI)
5. **Fill fields** → Populate supported form fields
6. **Upload resume** → Attach resume when available
7. **Re-scan dynamic forms** → Handle fields populated by ATS resume parser
8. **Pause for input** → Stop when human action is required
9. **Ready for review** → Candidate reviews completed form
10. **Final submission** → Submit according to configured mode

## Architecture

```
React/Vite Frontend
       ↓ /api
Express/TypeScript Backend
       ↓
Application Services
       ↓
Auto Apply Manager
       ↓
ATS Registry
       ↓
ATS Adapter
       ↓
Playwright / Visible Chrome
```

### Answer Resolution Pipeline

```
Normalized Form Question
       ↓
   Policy Check
       ↓
┌──────┴──────┐
│             │
L1 Profile    L2 Memory
(match)       (approved answers)
│             │
└──────┬──────┘
       ↓
    L3 Ollama
   (AI fallback)
       ↓
   Exact Option
   Matching
       ↓
   Fill Field
```

## Project Structure

```
campuspe_mvp/
├── frontend/
│   ├── src/
│   │   ├── App.tsx              Landing page and application dashboard
│   │   ├── ProfilePage.tsx      Candidate profile and resume upload
│   │   ├── api.ts               Frontend API helper
│   │   ├── main.tsx             React entry point
│   │   ├── styles.css           Design system and responsive styles
│   │   └── vite-env.d.ts        Vite type declarations
│   ├── index.html               HTML entry point
│   ├── vite.config.ts           Vite configuration
│   ├── package.json             Frontend dependencies
│   ├── package-lock.json        Frontend lockfile
│   └── tsconfig.json            Frontend TypeScript config
│
├── backend/
│   ├── src/
│   │   ├── automation/
│   │   │   ├── adapters/        ATS-specific browser implementations
│   │   │   │   ├── ashby/
│   │   │   │   ├── bamboohr/
│   │   │   │   ├── breezy/
│   │   │   │   ├── greenhouse/
│   │   │   │   ├── lever/
│   │   │   │   ├── recruitee/
│   │   │   │   ├── rippling/
│   │   │   │   └── workable/
│   │   │   ├── manager.ts       Run orchestration and browser lifecycle
│   │   │   ├── registry.ts      URL detection and adapter registry
│   │   │   ├── types.ts         Shared adapter contracts
│   │   │   └── *.test.ts        Adapter tests
│   │   ├── resolver/
│   │   │   ├── engine.ts         L1/L2/L3 answer pipeline
│   │   │   ├── normalizer.ts     Question normalization/classification
│   │   │   ├── ollama.ts         Local model provider and option guard
│   │   │   ├── optionMatcher.ts  Exact employer-option matching
│   │   │   ├── policy.ts         Sensitive and non-inferable question rules
│   │   │   └── *.test.ts        Resolver tests
│   │   ├── auth.ts               Cookie sessions
│   │   ├── config.ts             Local paths and service configuration
│   │   ├── database.ts           SQLite schema and migrations
│   │   ├── index.ts              Express API composition root
│   │   ├── jobs.ts               Public job-feed aggregation
│   │   ├── resumeDocument.ts     Tailored DOCX generation
│   │   ├── resumeReview.ts       Resume extraction, scoring, and optimization
│   │   └── security.ts           Password hashing and AES-GCM encryption
│   ├── package.json             Backend dependencies
│   ├── package-lock.json        Backend lockfile
│   └── tsconfig.json            Backend TypeScript config
│
├── data/                         Local runtime data (SQLite DB, encryption key)
├── uploads/                      Local resume storage
│   └── resumes/
│       └── tailored/             Approved tailored resumes
├── browser-data/                 Persistent Chrome profiles
├── package.json                 Root orchestration dependencies
├── package-lock.json            Root lockfile
├── tsconfig.json                Root TypeScript references
├── .gitignore                   Git ignore rules
└── README.md                    This file
```

## Tech Stack

### Frontend
- React with TypeScript
- Vite (build tool and dev server)
- Lucide React (icons)

### Backend
- Node.js with ESM
- Express (HTTP server)
- TypeScript
- SQLite (via `node:sqlite`)
- Playwright-core (browser automation)
- Zod (request validation)
- AES-256-GCM (encryption)

### AI (Optional)
- Ollama (local LLM for answer generation and resume analysis)

## Supported ATS Platforms

- Ashby
- Greenhouse
- Lever
- Workable
- BambooHR
- Breezy
- Rippling
- Recruitee

**Note:** ATS pages can change over time. Selectors and adapters may require maintenance when job boards update their HTML structure.

## Environment / Configuration

Configuration is read from environment variables. No `.env` loader is included, so export values in the shell before starting.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | No | `3001` | Backend API and production frontend port |
| `NODE_ENV` | No | - | Set to `production` for production mode |
| `OLLAMA_URL` | No | `http://127.0.0.1:11434` | Ollama server URL |
| `OLLAMA_MODEL` | No | `gemma3:4b` | Model for answer drafting and resume analysis |
| `CHROME_PATH` | No | Platform-specific | Chrome executable for dedicated Lever browser |
| `LEVER_CDP_URL` | No | `http://127.0.0.1:9222` | Local Chrome DevTools endpoint for Lever |
| `ASHBY_COMPANY_SLUGS` | No | Built-in list | Comma-separated Ashby companies for job discovery |
| `GREENHOUSE_COMPANY_SLUGS` | No | Built-in list | Comma-separated Greenhouse companies for job discovery |
| `LEVER_COMPANY_SLUGS` | No | Built-in list | Comma-separated Lever companies for job discovery |
| `WORKABLE_COMPANY_SLUGS` | No | Built-in list | Comma-separated Workable companies for job discovery |

Example:

```bash
export OLLAMA_MODEL=gemma3:4b
export GREENHOUSE_COMPANY_SLUGS=stripe,databricks
npm run dev
```

## Running the Application

### Start Both Services

```bash
npm run dev
```

Starts frontend (Vite) and backend (Express) concurrently.

### Start Services Separately

**Terminal 1 - Backend:**

```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**

```bash
cd frontend
npm run dev
```

### Service URLs

- Frontend: `http://localhost:5173` (or next available port)
- Backend API: `http://127.0.0.1:3001`
- Health check: `http://127.0.0.1:3001/api/health`

## First-Time Setup

On first run, the application automatically creates:

- `data/` directory with `jobcopilot.db` (SQLite database) and `jobcopilot.key` (encryption key)
- `uploads/resumes/` directory for uploaded resumes
- `uploads/resumes/tailored/` directory for approved tailored resumes
- `browser-data/` directory for persistent Chrome profiles

All directories are created with restrictive permissions (mode 0o700).

## Using Auto Apply

### Create an Account

1. Open `http://localhost:5173`
2. Click "Sign up"
3. Enter email, name, and password
4. Complete your candidate profile

### Upload a Resume

1. Go to Profile
2. Upload a PDF, DOC, or DOCX resume
3. The resume is stored locally under `uploads/resumes/`

### Start an Application

1. Go to Dashboard
2. Paste a supported ATS job URL
3. Choose submission mode:
   - **Submit with approval** (default): Fills form, stops for review before submission
   - **Assisted submission**: The user clicks Submit on the filled employer form
4. Click "Start application"
5. A visible Chrome window opens and automation begins

### Monitor Progress

The dashboard shows:
- Current automation status
- Step-by-step progress
- Any pauses requiring input
- Final state (READY_FOR_REVIEW, SUBMITTED, PAUSED_*, or FAILED)

## Human-in-the-Loop Behavior

The automation intentionally pauses when:

- **CAPTCHA encountered**: Complete the CAPTCHA in the visible browser, then click "Continue automation"
- **Login required**: Log into the ATS site in the visible browser, then continue
- **Missing required information**: Add the missing data to your profile or provide it manually
- **Sensitive questions**: Demographic, visa, or other protected questions may pause for explicit user input
- **Uncertain answers**: When confidence is low, the system pauses for user approval
- **Final review**: Always stops at READY_FOR_REVIEW before the user submits in the assisted browser

**Important:** CAPTCHA and login challenges are NOT solved automatically. Human intervention is required.

## Application States

| State | Meaning |
| --- | --- |
| `QUEUED` | Automation run created, waiting to start |
| `OPENING_JOB` | Launching Chrome and opening job page |
| `EXTRACTING_JOB` | Waiting for application form to load |
| `FILLING_APPLICATION` | Actively filling form fields |
| `PAUSED_BY_USER` | User manually paused the run |
| `PAUSED_NEEDS_INPUT` | Waiting for user to provide missing information |
| `PAUSED_LOGIN` | ATS login required |
| `PAUSED_CAPTCHA` | CAPTCHA challenge detected |
| `READY_FOR_REVIEW` | Form filled, waiting for user review/approval |
| `SUBMITTING` | Submitting the application |
| `SUBMITTED` | Application successfully submitted |
| `FAILED` | Automation failed with an error |

## Candidate Answer Resolution

### L1 — Profile Resolver

Highest-confidence source. Uses saved candidate profile data:
- Name, email, phone
- Location preferences
- Work history
- Education
- Authorization status
- Sponsorship requirements
- Salary expectations
- Links (LinkedIn, GitHub, portfolio)

### L2 — Answer Memory

Searches previously approved answers using normalized question similarity. Memories can be:
- **Global**: Reusable across any company
- **Company-specific**: Restricted to one employer

### L3 — Ollama Fallback

Local AI generates answers for:
- Ordinary written questions (text fields)
- Supported choice questions (selects, radios)

The AI is constrained to:
- Return only visible employer options for choice controls
- Generate truthful prose only for text controls
- Not invent candidate facts, skills, or qualifications

If confidence is low or the answer doesn't match visible options, the system pauses for user input.

## Resume Handling

### Upload and Storage

- Resumes uploaded via Profile are stored in `uploads/resumes/`
- Supported formats: PDF, DOC, DOCX
- File size limit: 10 MB
- MIME-type validation enforced

### Resume Review

- Extracts text from PDF (`pdf-parse`) and DOCX (`mammoth`)
- Analyzes resume against job requirements using Ollama
- Provides score and improvement suggestions
- Deterministic fallback when Ollama is unavailable

### Tailored Resumes

- Generate job-specific optimized resumes
- Creates DOCX files in `uploads/resumes/tailored/`
- Requires user approval before generation
- Can be attached during Auto Apply if matching the job URL

### Auto Apply Resume Attachment

- Attaches the most recent approved tailored resume matching the job URL
- Falls back to default resume if no tailored version exists
- Uploads resume via ATS file input when supported

## Browser Sessions

### Playwright and Chrome

- Uses `playwright-core` for browser automation
- Launches visible Google Chrome windows
- Persistent browser profiles stored in `browser-data/<user-id>/`

### Session Persistence

- Browser profiles persist logins and cookies across automation runs
- If a profile is locked, creates an isolated fallback profile
- Lever uses a dedicated Chrome session connected via CDP at port 9222

### Browser Data Deletion

**Warning:** Deleting `browser-data/` removes persistent ATS browser sessions. Users will need to log into ATS sites again after deletion.

## Database & Runtime Data

### SQLite Database

Location: `data/jobcopilot.db`

Tables:
- `users` — Local accounts and password credentials
- `sessions` — Hashed browser session tokens and expiration
- `profiles` — Candidate details, resume metadata, encrypted voluntary information
- `answer_memory` — User-approved answers (global or company-specific)
- `resolution_log` — Audit trail of question resolution
- `automation_runs` — Application run state and history
- `automation_events` — Timeline for each automation run
- `saved_jobs` — Saved job discovery results
- `resume_optimizations` — Job-specific resume proposals

### Encryption Key

Location: `data/jobcopilot.key`

- Generated automatically on first run
- Used for AES-256-GCM encryption of sensitive data
- **Warning:** Do not delete this key if encrypted data exists

### Runtime Directories

```
data/                    SQLite database and encryption key
uploads/resumes/         Uploaded default resumes
uploads/resumes/tailored/ Approved tailored resumes
browser-data/            Persistent Chrome profiles
```

These directories contain personal information and are ignored by Git.

## Development Commands

| Command | Location | Purpose |
| --- | --- | --- |
| `npm run dev` | Root | Start frontend + backend concurrently |
| `npm run dev:frontend` | Root | Start only Vite frontend |
| `npm run dev:backend` | Root | Start only Express backend |
| `npm run build` | Root | Build frontend and backend |
| `npm run build:frontend` | Root | Build only frontend |
| `npm run build:backend` | Root | Build only backend |
| `npm run test` | Root | Run backend test suite |
| `npm run start` | Root | Start production backend |

## Building for Production

```bash
npm run build
```

This creates:
- `frontend/dist/` — Built React application
- `backend/dist/` — Compiled TypeScript backend

## Running Production Build

```bash
NODE_ENV=production npm run start
```

In production mode:
- Backend serves the built frontend from `frontend/dist/`
- Frontend static assets are served at root
- API routes remain at `/api/*`
- Unknown API routes return JSON 404
- Non-API routes return the SPA index

Open `http://127.0.0.1:3001` to access the production application.

## Testing

Run the backend test suite:

```bash
npm run test
```

The suite includes 40 tests covering:
- ATS URL detection
- Browser session separation
- Question normalization and canonical classification
- Exact option matching
- Overlapping choices (e.g., Male/Female)
- Pronoun and demographic selection behavior
- Greenhouse school and education controls
- Lever submit buttons and CAPTCHA detection
- Restricted-question and testing-mode policy
- Ollama response validation

## Troubleshooting

### Port 3001 Already in Use

```bash
export PORT=3002
npm run dev
```

### Vite Port Already in Use

Vite automatically selects the next available port. Use the URL printed beside `WEB` in the terminal.

### Chrome Executable Not Found

Set the Chrome path explicitly:

```bash
export CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run dev
```

### Browser Doesn't Open

1. Check Chrome is installed
2. Verify `CHROME_PATH` if on macOS/Linux
3. Check browser-data permissions
4. Ensure no Chrome profile locks

### Ollama Unavailable

Without Ollama:
- Profile-driven filling still works
- AI-generated answers may pause for user input
- Resume review uses deterministic fallback

Check Ollama status:

```bash
ollama list
curl http://127.0.0.1:11434/api/tags
```

Start it:

```bash
ollama serve
ollama pull gemma3:4b
```

The backend prints `Ollama ready` or a missing-model warning when it starts.

### Employer flagged the application as spam

Ashby (and other boards) can reject automated browsers. JobCopilot cannot bypass that filter.

Typical causes:
- Location or another required field was not a unique live option, so the live form was incomplete
- Several automated submits in a short time
- VPN or bot-like traffic

What to do:
1. Complete Location in the assisted preview (type the city until one suggestion remains, then select it).
2. Do not click Submit until required fields are filled.
3. Wait before retrying the same Ashby job.
4. Turn off a VPN if you use one.
5. Treat a spam banner as a failed submit, not as success. JobCopilot will stop verifying instead of hanging.

### ATS Page Changed

Job boards may update HTML structure. Symptoms:
- Fields not detected
- Options not read
- Submit button not found

This requires adapter selector updates (code change, not configuration).

### CAPTCHA Encountered

This is intentional. Complete the CAPTCHA in the visible browser, then click "Continue automation" in the dashboard.

### PAUSED_NEEDS_INPUT

The automation is waiting for:
- Missing profile information
- Uncertain answer
- Sensitive question

Add the missing data to your profile or provide it manually in the browser, then continue.

### Resume Missing

The automation pauses at the resume upload step if:
- No resume is uploaded to your profile
- No tailored resume matches the job URL

Upload a resume in the Profile section, then restart or continue the automation.

### Database or Encryption Key Issues

**Warning:** Do not delete `data/jobcopilot.db` or `data/jobcopilot.key` unless you intend to reset all data. Deleting the encryption key will make encrypted data unreadable.

### npm Dependencies Missing

If you see module not found errors:

```bash
# Root
npm install

# Frontend
cd frontend && npm install

# Backend
cd ../backend && npm install
```

## Safety / Submission Behavior

### Default Mode: Submit with Approval

- Fills the application form
- Stops at `READY_FOR_REVIEW`
- User reviews the completed form in the visible browser
- User explicitly approves final submission

### Auto-Submit Mode

- Submits after filling and validation
- Still pauses for CAPTCHA, login, or missing information
- Requires explicit user configuration

### Testing Mode

- Always disables submission, even if auto-submit is enabled
- May use test-only fallback answers
- Used for observing the complete filling flow

### Manual Pause and Continue

- Active runs can be paused from the dashboard
- Continue resumes the same browser session
- Re-scans the form and skips completed fields

### Final Submission

The application does **not** silently submit applications in the default configuration. The final Submit is controlled by the user in the assisted browser.

CAPTCHA, login, and manual-input situations always require human intervention.

## Current Architectural Boundaries

- Active Playwright browser objects are in memory; after API restart, unfinished runs cannot reconnect
- SQLite and browser profiles are local to one machine
- Suited for local development and single-machine usage, not horizontally scaled deployment
- Job-board HTML changes may require adapter selector updates
- CAPTCHA, login, and protected declarations may require manual interaction
- Resume optimization produces a new Word document and does not preserve original PDF/LaTeX visual templates

These constraints are deliberate and should be revisited before turning CampusPe into a hosted multi-user service.

### Automation stabilization (September 2026)

The backend owns matching, answer policy, live filling, validation, and confirmation. Public schemas provide the native review form; the live ATS controls are authoritative when applying reviewed answers. The existing adapters remain in place. There is no Chrome extension or second automation engine.

Each browser worker launches installed Google Chrome in modern headless mode (`channel: 'chrome', headless: true`) with a fresh temporary profile and browser context. Install Chrome in its standard location on the backend host before running automation; the launcher does not fall back to headless shell or reuse personal browser sessions. Submission hands its existing page to assisted mode for missing answers, ambiguous controls, CAPTCHA, or login. Extraction-time blockers also retain their page. Assisted mode checks the live required fields when the user requests Submit, and never automatically retries after CAPTCHA. Its preview transports input to that retained page; employer application iframes are disabled.

Ollama is restricted to narrative questions. Profile/resume and approved answers take priority; factual and choice questions without evidence require user input. Live reconciliation drops removed fields and uses current locators. A navigation or success-looking URL alone is not confirmation.

The status display maps backend and assisted-session states to PREPARING, FILLING, REVIEW, USER_ACTION_REQUIRED, SUBMITTING, VERIFYING, SUBMITTED, or FAILED. Backend errors take precedence over readiness.

Run `npm run build` and `npm test` to verify. The stabilization browser tests require installed Google Chrome and intentionally fail rather than silently skip when it cannot launch. Tests use local fixtures; passing them does not establish that a real employer accepted a submission. Browser capacity remains dependent on host memory and CPU; these checks do not constitute a production volume benchmark.

### India discovery and one-click auto apply

Discovery defaults to India across the Ashby, Greenhouse, Lever, and Workable feeds; select **All countries** to widen the search. Workable city/country fields are normalized, and unknown-location remote jobs are not assumed eligible from India. Partial feed failures are shown without discarding available jobs.

Click **Assisted apply** on a job card to prepare that application for the assisted browser. Saved facts take priority; newly revealed narrative questions can use contextual Ollama drafts. Pasting a link does not submit it until you click the action. Genuine missing facts and employer protection challenges can still require your input. A spam rejection is shown without guessing its cause or suggesting repeated submissions.

Application history now has **View application** to reopen a saved run without starting another application. Poll responses cannot replace a different selected run. On API restart, lost active workers are marked interrupted; potentially sent applications are never automatically retried.

Greenhouse discovery retains the employer's job-description link while passing the canonical ATS job link to automation. If that ATS link redirects, the existing adapter follows the employer's visible Apply link and opens the published Greenhouse form URL as the top-level page, preserving any employer-provided validity token. Non-resume attachments remain separate and cannot be satisfied by the saved resume.

Read-only live verification on September 9, 2026 covered two India postings per portal: Databricks and Stripe (Greenhouse), two D&B research roles (Lever), two Exponent Energy graduate roles (Workable), and Ema plus Notion (Ashby). All eight live forms were reached and extracted after the redirect fixes; both Greenhouse forms exposed passive invisible-reCAPTCHA badges. Those badges are no longer mistaken for interactive challenges; actual challenges still require the user. The signed-in UI was checked for discovery, profile display, saved-run reopening, and a non-submitting test run. This verification did not send or confirm a real employer application.

Review-form regressions: `npm run build` followed by `node backend/scripts/test-review-ui.mjs` checks older approval and auto-submit saved runs in installed Chrome; both now use only assisted handoff, with all API/employer traffic mocked. It checks multi-choice selection, radio/select editing, the shared phone-country selector, and delayed answer saves immediately followed by Continue/assisted handoff. No employer application is sent.

Answer saves are serialized per run and finish before Continue, Submit, or assisted handoff. Local edits are preserved across status refreshes. Duplicate submission requests return the existing run; state conflicts return a descriptive 409 response. An explicit spam rejection cannot reopen an assisted session, and generic employer errors are no longer labeled spam.

Submission timeout handling preserves the original browser in assisted observation mode, without refilling or replaying Submit. Late ATS confirmations are still detected. Visible post-submit field errors are reported as user input rather than a generic timeout. If the original session was lost, the uncertain attempt cannot be replayed automatically.

For a future diagnostic run, set `AUTOMATION_TRACE=1` in the backend environment. Traces are saved locally to `data/traces/<run-id>.zip` (ignored by Git). Open one with `npx playwright show-trace /absolute/path/to/trace.zip` from `backend`. Traces can contain applicant form data; they are not uploaded. The timeout regression creates a synthetic-data trace at `/tmp/jobcopilot-submission-timeout.zip` and tests late confirmation without a second submission.

Assisted-only mode: new runs ignore the legacy auto-submit flag. Both legacy Submit endpoints hand off to the existing assisted session. Automatic filling pauses for a random 300–900 ms between answers; the user’s final Submit click is not randomized or replayed. This pacing does not bypass employer protections or guarantee acceptance.

The assisted side panel now offers **Submit application** after the live page is ready. This explicit user action re-extracts the same page, fills missing safe answers while preserving live edits, validates, and invokes the existing ATS submit adapter once. Concurrent clicks and uncertain timeouts cannot replay submission. Success still requires ATS confirmation. Lever résumé validation recognizes its uploaded storage ID/success state even when the file input is reset.
