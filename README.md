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

This starts both services:

- Frontend: `http://localhost:5173`
- Backend API: `http://127.0.0.1:3001`

If port 5173 is occupied, Vite automatically selects the next free port (5174, 5175, etc.). Use the URL printed beside `WEB` in the terminal.

### Stop the Application

Press `Ctrl+C` in the terminal running `npm run dev`.

## Key Features

- Responsive React dashboard for desktop and mobile
- Local account and reusable application profile
- Resume upload, preview, review, job matching, and optimization suggestions
- Visible-browser application automation with human-in-the-loop control
- Pause, continue, review-before-submit, auto-submit, and testing modes
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
   - **Auto-submit**: Submits after filling (requires explicit configuration)
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
- **Final review**: Always stops at READY_FOR_REVIEW unless auto-submit is explicitly enabled

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

The application does **not** silently submit applications in the default configuration. Human review and approval are required unless auto-submit is explicitly enabled.

CAPTCHA, login, and manual-input situations always require human intervention.

## Current Architectural Boundaries

- Active Playwright browser objects are in memory; after API restart, unfinished runs cannot reconnect
- SQLite and browser profiles are local to one machine
- Suited for local development and single-machine usage, not horizontally scaled deployment
- Job-board HTML changes may require adapter selector updates
- CAPTCHA, login, and protected declarations may require manual interaction
- Resume optimization produces a new Word document and does not preserve original PDF/LaTeX visual templates

These constraints are deliberate and should be revisited before turning CampusPe into a hosted multi-user service.
