import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { createSession, getSession, invalidateSession, invalidateAllSessionsForUser } from './auth';
import { getOrCreateDraft, getDraftById, updateDraftStep, submitApplication, resetApplicationState } from './applications';
import { chaosMiddleware, chaosState } from './chaos';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Setup upload storage directory (handles local disk vs Vercel /tmp serverless storage)
const uploadDir = process.env.VERCEL
  ? path.join('/tmp', 'uploads')
  : path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadDir)) {
  try {
    fs.mkdirSync(uploadDir, { recursive: true });
  } catch (_e) {
    // ignore if already created
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(chaosMiddleware);

// Serve static frontend UI (supports local dev, dist, and Vercel serverless)
const publicDir = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : fs.existsSync(path.join(process.cwd(), 'server', 'public'))
  ? path.join(process.cwd(), 'server', 'public')
  : path.join(__dirname, '..', 'server', 'public');
app.use(express.static(publicDir));

// Helper to extract session token from cookie or header
function extractToken(req: Request): string | undefined {
  if (req.cookies && req.cookies.cpe_session) {
    return req.cookies.cpe_session;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return undefined;
}

// Session authentication middleware
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const session = getSession(token);

  if (!session) {
    res.status(401).json({
      error: 'Unauthorized',
      code: 'SESSION_EXPIRED',
      message: 'Your session has expired or is invalid. Please re-authenticate to continue.'
    });
    return;
  }

  // Attach session to request
  (req as any).user = session;
  next();
}

/* ============================================================
   AUTH ENDPOINTS
   ============================================================ */

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, name } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const session = createSession(email, name || email.split('@')[0]);
  
  // Set secure cookie
  res.cookie('cpe_session', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: session.expiresAt - session.createdAt
  });

  res.json({
    success: true,
    token: session.token,
    user: {
      userId: session.userId,
      email: session.email,
      name: session.name,
      expiresAt: session.expiresAt
    }
  });
});

app.get('/api/auth/session', (req: Request, res: Response) => {
  const token = extractToken(req);
  const session = getSession(token);

  if (!session) {
    res.status(401).json({
      authenticated: false,
      code: 'SESSION_EXPIRED',
      message: 'Session has expired or does not exist.'
    });
    return;
  }

  res.json({
    authenticated: true,
    user: {
      userId: session.userId,
      email: session.email,
      name: session.name,
      expiresAt: session.expiresAt
    }
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const token = extractToken(req);
  if (token) invalidateSession(token);
  res.clearCookie('cpe_session');
  res.json({ success: true, message: 'Logged out successfully.' });
});

/* ============================================================
   CHAOS INJECTION ENDPOINTS
   ============================================================ */

app.post('/api/chaos/expire-session', (req: Request, res: Response) => {
  const token = extractToken(req);
  const { email, token: targetToken } = req.body || {};

  if (targetToken) {
    invalidateSession(targetToken);
  } else if (email) {
    invalidateAllSessionsForUser(email);
  } else if (token) {
    invalidateSession(token);
  }

  res.json({
    success: true,
    message: 'Session forcibly expired for testing.',
    tokenInvalidated: targetToken || token || 'all'
  });
});

app.post('/api/chaos/configure', (req: Request, res: Response) => {
  const { networkLatencyMs, forceServerErrorSteps, resetChaos } = req.body;

  if (resetChaos) {
    chaosState.networkLatencyMs = 0;
    chaosState.forceServerErrorSteps = [];
    chaosState.sessionExpiryInjected = false;
    res.json({ success: true, message: 'Chaos configurations reset to normal.' });
    return;
  }

  if (typeof networkLatencyMs === 'number') chaosState.networkLatencyMs = networkLatencyMs;
  if (Array.isArray(forceServerErrorSteps)) chaosState.forceServerErrorSteps = forceServerErrorSteps;

  res.json({
    success: true,
    config: chaosState
  });
});

/* ============================================================
   APPLICATION WORKFLOW ENDPOINTS (Step 1-6)
   ============================================================ */

// Get or initialize draft for candidate
app.get('/api/applications/current', requireAuth, (req: Request, res: Response) => {
  const user = (req as any).user;
  const draft = getOrCreateDraft(user.userId, user.email);
  res.json({ success: true, draft });
});

// Step 1: Personal Information
app.post('/api/applications/:id/step/1', requireAuth, (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { fullName, email, phone, location, linkedIn, portfolio } = req.body;

  if (!fullName || !email || !phone) {
    res.status(400).json({ error: 'Full name, email, and phone are required.' });
    return;
  }

  try {
    const updated = updateDraftStep(id, 2, {
      personalInfo: { fullName, email, phone, location: location || 'Bangalore, India', linkedIn, portfolio }
    });
    res.json({ success: true, step: 1, nextStep: 2, draft: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Step 2: Education
app.post('/api/applications/:id/step/2', requireAuth, (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { degree, institution, fieldOfStudy, graduationYear, gpa } = req.body;

  if (!degree || !institution || !graduationYear) {
    res.status(400).json({ error: 'Degree, institution, and graduation year are required.' });
    return;
  }

  try {
    const updated = updateDraftStep(id, 3, {
      education: { degree, institution, fieldOfStudy: fieldOfStudy || 'Computer Science', graduationYear, gpa }
    });
    res.json({ success: true, step: 2, nextStep: 3, draft: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Step 3: Experience
app.post('/api/applications/:id/step/3', requireAuth, (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { currentCompany, jobTitle, yearsOfExperience, responsibilities, techStack } = req.body;

  if (!currentCompany || !jobTitle || !yearsOfExperience) {
    res.status(400).json({ error: 'Company, job title, and years of experience are required.' });
    return;
  }

  try {
    const updated = updateDraftStep(id, 4, {
      experience: { currentCompany, jobTitle, yearsOfExperience, responsibilities: responsibilities || '', techStack }
    });
    res.json({ success: true, step: 3, nextStep: 4, draft: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Step 4: Resume Upload
app.post('/api/applications/:id/resume', requireAuth, upload.single('resume'), (req: Request, res: Response) => {
  const id = req.params.id as string;
  const file = req.file;

  if (!file) {
    res.status(400).json({ error: 'No resume file provided' });
    return;
  }

  try {
    const updated = updateDraftStep(id, 5, {
      resume: {
        fileName: file.filename,
        originalName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedAt: new Date().toISOString()
      }
    });
    res.json({ success: true, step: 4, nextStep: 5, resume: updated.resume, draft: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Step 5: Review summary
app.get('/api/applications/:id/review', requireAuth, (req: Request, res: Response) => {
  const id = req.params.id as string;
  const draft = getDraftById(id);

  if (!draft) {
    res.status(404).json({ error: `Application ${id} not found` });
    return;
  }

  res.json({ success: true, draft });
});

// Step 6: Final Submit (with Idempotency validation)
app.post('/api/applications/:id/submit', requireAuth, (req: Request, res: Response) => {
  const id = req.params.id as string;
  const idempotencyKey = (req.headers['idempotency-key'] as string) || req.body.idempotencyKey;

  try {
    const result = submitApplication(id, idempotencyKey);
    const status = result.isDuplicate ? 200 : 201; // Or 200/201 with duplicate indicator
    res.status(status).json({
      success: true,
      applicationId: result.application.applicationId,
      status: result.application.status,
      submittedAt: result.application.submittedAt,
      isDuplicate: result.isDuplicate,
      message: result.message
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Admin endpoint for testing cleanup
app.post('/api/admin/reset', (_req: Request, res: Response) => {
  resetApplicationState();
  res.json({ success: true, message: 'All test state reset.' });
});

// Fallback to SPA index.html
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[CampusPE Mock Server] Running at http://localhost:${PORT}`);
  });
}

export default app;
