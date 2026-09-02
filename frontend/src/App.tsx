import { useEffect, useRef, useState } from 'react'
import { apiRequest, type Education, type RecommendedJob, type StoredProfile, type WorkExperience } from './api'
import { ProfilePage } from './ProfilePage'
import {
  ArrowRight,
  BadgeCheck,
  Bookmark,
  Bot,
  Building2,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  ExternalLink,
  FileCheck2,
  FileDown,
  FileSearch,
  GraduationCap,
  History,
  LayoutDashboard,
  Link2,
  Menu,
  MapPin,
  Pause,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from 'lucide-react'

type AuthMode = 'login' | 'signup' | null
type ProfileSeed = { name: string; email: string }
type DashboardTab = 'discover' | 'resume' | 'auto-apply' | 'applications'
type ResumeReview = { score: number; summary: string; strengths: string[]; tips: Array<{ priority: 'high' | 'medium' | 'low'; title: string; detail: string }>; matchedKeywords?: string[]; missingKeywords?: string[] }
type ResumeTargetJob = { url: string; board: string; title: string; company: string; location: string; description: string }
type ResumeOptimization = { id: string; mode: 'review' | 'automatic'; status: 'DRAFT' | 'APPROVED'; job: { url: string; title: string; company: string; location: string }; proposal: { originalScore: number; optimizedScore: number; headline: string; changes: Array<{ section: string; before: string; after: string; reason: string }>; tailoredResumeText: string; safetyNote: string } }
type AutomationRun = {
  id: string
  jobUrl: string
  jobBoard: string
  status: 'QUEUED' | 'OPENING_JOB' | 'EXTRACTING_JOB' | 'FILLING_APPLICATION' | 'PAUSED_BY_USER' | 'PAUSED_NEEDS_INPUT' | 'PAUSED_LOGIN' | 'PAUSED_CAPTCHA' | 'READY_FOR_REVIEW' | 'SUBMITTING' | 'SUBMITTED' | 'FAILED'
  currentStep: string
  autoSubmit?: boolean
  testMode?: boolean
  browserActive?: boolean
  job?: { company?: string; jobTitle?: string; location?: string } | null
  pause?: { reason?: string; instruction?: string; question?: { text?: string } } | null
  error?: string | null
  events?: Array<{ message: string; createdAt: string }>
  createdAt: string
  updatedAt: string
}
type JobsResponse = { data: { jobs: RecommendedJob[]; sources: Array<{ source: RecommendedJob['source']; jobs: number }>; pagination: { offset: number; limit: number; total: number; hasMore: boolean } } }

const roles = [
  { company: 'Linear', role: 'Frontend Engineer', meta: 'Remote · Product', match: '96%', color: '#5e6ad2' },
  { company: 'Vercel', role: 'Software Engineer', meta: 'Remote · Platform', match: '92%', color: '#111827' },
  { company: 'Notion', role: 'Product Engineer', meta: 'Bengaluru · Hybrid', match: '89%', color: '#f0a24b' },
]

const steps = [
  { icon: Target, number: '01', title: 'Tell us what fits', copy: 'Set your role, location, experience, and work preferences once.' },
  { icon: Compass, number: '02', title: 'Discover strong matches', copy: 'See relevant roles in one focused feed, ranked around your preferences.' },
  { icon: Bot, number: '03', title: 'Apply with a copilot', copy: 'Paste a job link, review every detail, and let guided automation do the repetitive work.' },
]

function Logo() {
  return (
    <a className="logo" href="#top" aria-label="JobCopilot home">
      <span className="logo-mark"><BriefcaseBusiness size={18} strokeWidth={2.4} /></span>
      <span>Job<span>Copilot</span></span>
    </a>
  )
}

function AuthModal({ mode, onClose, onSwitch, onComplete }: { mode: Exclude<AuthMode, null>; onClose: () => void; onSwitch: (mode: Exclude<AuthMode, null>) => void; onComplete: (profile: ProfileSeed, isNew: boolean) => void }) {
  const isLogin = mode === 'login'
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Close dialog"><X size={20} /></button>
        <div className="auth-brand"><Logo /></div>
        <p className="eyebrow">{isLogin ? 'Welcome back' : 'Start your search'}</p>
        <h2 id="auth-title">{isLogin ? 'Log in to JobCopilot' : 'Create your account'}</h2>
        <p className="auth-intro">{isLogin ? 'Continue where you left off.' : 'A calmer, more focused way to find your next role.'}</p>
        <form onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          setAuthError('')
          setAuthLoading(true)
          try {
            const payload = isLogin
              ? { email: String(data.get('email') || ''), password: String(data.get('password') || '') }
              : { name: String(data.get('name') || ''), email: String(data.get('email') || ''), password: String(data.get('password') || '') }
            const result = await apiRequest<{ data: { user: ProfileSeed } }>(isLogin ? '/api/auth/login' : '/api/auth/signup', { method: 'POST', body: JSON.stringify(payload) })
            onComplete(result.data.user, !isLogin)
          } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Unable to continue.')
          } finally {
            setAuthLoading(false)
          }
        }}>
          {!isLogin && (
            <label>
              Full name
              <input name="name" type="text" autoComplete="name" placeholder="Aryan Singh" required />
            </label>
          )}
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
          </label>
          <div className="password-field">
            <div className="label-row">
              <label htmlFor="password">Password</label>
              {isLogin && <button type="button" className="text-button">Forgot password?</button>}
            </div>
            <input id="password" name="password" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} placeholder="At least 8 characters" minLength={8} required />
          </div>
          {authError && <p className="form-error" role="alert">{authError}</p>}
          <button className="button primary full" type="submit" disabled={authLoading}>
            {authLoading ? 'Please wait…' : isLogin ? 'Log in' : 'Create account'} {!authLoading && <ArrowRight size={17} />}
          </button>
        </form>
        <p className="auth-switch">
          {isLogin ? 'New to JobCopilot?' : 'Already have an account?'}{' '}
          <button className="text-button" onClick={() => onSwitch(isLogin ? 'signup' : 'login')}>
            {isLogin ? 'Create account' : 'Log in'}
          </button>
        </p>
        <p className="local-note"><ShieldCheck size={15} /> Your information stays on your device.</p>
      </section>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="profile-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function LegacyProfilePage({ onHome, onComplete, profile }: { onHome: () => void; onComplete: () => void; profile: ProfileSeed }) {
  const [resumeName, setResumeName] = useState('')
  const [allowSensitiveAnswers, setAllowSensitiveAnswers] = useState(false)
  const [saved, setSaved] = useState(false)
  const [experiences, setExperiences] = useState([1])
  const [education, setEducation] = useState([1])
  const initials = profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

  const saveProfile = (event: React.FormEvent) => {
    event.preventDefault()
    setSaved(true)
    window.setTimeout(onComplete, 550)
  }

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div className="container profile-nav">
          <button className="logo logo-button" onClick={onHome}><span className="logo-mark"><BriefcaseBusiness size={18} /></span><span>Job<span>Copilot</span></span></button>
          <div className="profile-nav-actions"><span className="autosave"><Check size={14} /> Local profile</span><span className="profile-avatar">{initials}</span></div>
        </div>
      </header>
      <main className="profile-main container">
        <aside className="profile-sidebar">
          <div className="profile-person"><span className="profile-avatar large">{initials}</span><div><strong>{profile.name}</strong><small>Application profile</small></div></div>
          <nav aria-label="Profile sections">
            <a className="active" href="#resume"><FileCheck2 /> Resume</a>
            <a href="#personal"><UserRound /> Personal details</a>
            <a href="#experience"><Building2 /> Work experience</a>
            <a href="#education"><GraduationCap /> Education</a>
            <a href="#application"><BriefcaseBusiness /> Application defaults</a>
            <a href="#voluntary"><ShieldCheck /> Voluntary information</a>
          </nav>
          <div className="profile-progress"><span><b>Profile strength</b><strong>35%</strong></span><div><i /></div><small>Add your resume and details to speed up applications.</small></div>
        </aside>

        <form className="profile-content" onSubmit={saveProfile}>
          <div className="profile-title"><div><p className="eyebrow">Application profile</p><h1>Set up your reusable answers</h1><p>JobCopilot can use these details when preparing applications. You’ll always review them before submission.</p></div><button className="button primary" type="submit">Save profile</button></div>

          <section className="profile-card" id="resume">
            <div className="card-heading"><span className="card-icon"><FileCheck2 /></span><div><h2>Resume</h2><p>Your default resume for job applications.</p></div></div>
            <label className={`upload-zone ${resumeName ? 'has-file' : ''}`}>
              <input type="file" accept=".pdf,.doc,.docx" onChange={(event) => setResumeName(event.target.files?.[0]?.name ?? '')} />
              <span className="upload-icon">{resumeName ? <FileCheck2 /> : <UploadCloud />}</span>
              <span><strong>{resumeName || 'Upload your resume'}</strong><small>{resumeName ? 'Ready to use in applications' : 'PDF, DOC, or DOCX · maximum 10 MB'}</small></span>
              <span className="button secondary upload-button">{resumeName ? 'Replace' : 'Choose file'}</span>
            </label>
          </section>

          <section className="profile-card" id="personal">
            <div className="card-heading"><span className="card-icon"><UserRound /></span><div><h2>Personal details</h2><p>Basic information commonly requested by employers.</p></div></div>
            <div className="form-grid">
              <Field label="Full name"><input defaultValue={profile.name} /></Field>
              <Field label="Email address"><input type="email" defaultValue={profile.email} placeholder="you@example.com" /></Field>
              <Field label="Phone number"><input type="tel" placeholder="+91 98765 43210" /></Field>
              <Field label="Current location"><input placeholder="Bengaluru, India" /></Field>
              <Field label="LinkedIn profile"><input type="url" placeholder="https://linkedin.com/in/…" /></Field>
              <Field label="Portfolio or website"><input type="url" placeholder="https://yourportfolio.com" /></Field>
            </div>
          </section>

          <section className="profile-card" id="experience">
            <div className="card-heading section-card-heading"><span className="card-icon"><Building2 /></span><div><h2>Work experience</h2><p>Your employment history for application forms.</p></div><button className="button secondary compact" type="button" onClick={() => setExperiences((items) => [...items, Math.max(...items) + 1])}><Plus /> Add experience</button></div>
            <div className="repeatable-list">
              {experiences.map((id, index) => (
                <fieldset className="repeatable-item" key={id}>
                  <legend>Experience {index + 1}</legend>
                  {experiences.length > 1 && <button className="remove-button" type="button" onClick={() => setExperiences((items) => items.filter((item) => item !== id))} aria-label={`Remove experience ${index + 1}`}><Trash2 /></button>}
                  <div className="form-grid">
                    <Field label="Job title"><input placeholder="e.g. Automation Engineer" /></Field>
                    <Field label="Company"><input placeholder="e.g. Tsenta" /></Field>
                    <Field label="Employment type"><select defaultValue=""><option value="" disabled>Select type</option><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Internship</option><option>Freelance</option></select></Field>
                    <Field label="Location"><input placeholder="City or remote" /></Field>
                    <Field label="Start date"><input type="month" /></Field>
                    <Field label="End date"><input type="month" /></Field>
                  </div>
                  <label className="inline-check"><input type="checkbox" /> I currently work here</label>
                  <Field label="Role description" hint="Mention responsibilities, impact, tools, and measurable results."><textarea rows={4} placeholder="Describe what you worked on and what you achieved…" /></Field>
                </fieldset>
              ))}
            </div>
          </section>

          <section className="profile-card" id="education">
            <div className="card-heading section-card-heading"><span className="card-icon"><GraduationCap /></span><div><h2>Education</h2><p>Degrees and qualifications commonly requested by employers.</p></div><button className="button secondary compact" type="button" onClick={() => setEducation((items) => [...items, Math.max(...items) + 1])}><Plus /> Add education</button></div>
            <div className="repeatable-list">
              {education.map((id, index) => (
                <fieldset className="repeatable-item" key={id}>
                  <legend>Education {index + 1}</legend>
                  {education.length > 1 && <button className="remove-button" type="button" onClick={() => setEducation((items) => items.filter((item) => item !== id))} aria-label={`Remove education ${index + 1}`}><Trash2 /></button>}
                  <div className="form-grid">
                    <Field label="School or university"><input placeholder="Institution name" /></Field>
                    <Field label="Degree"><select defaultValue=""><option value="" disabled>Select degree</option><option>High school</option><option>Diploma</option><option>Bachelor’s degree</option><option>Master’s degree</option><option>Doctorate</option><option>Other</option></select></Field>
                    <Field label="Field of study"><input placeholder="e.g. Computer Science" /></Field>
                    <Field label="Grade / GPA" hint="Optional"><input placeholder="e.g. 8.5 CGPA" /></Field>
                    <Field label="Start date"><input type="month" /></Field>
                    <Field label="Graduation date"><input type="month" /></Field>
                  </div>
                  <Field label="Activities or description" hint="Optional"><textarea rows={3} placeholder="Relevant coursework, activities, or achievements…" /></Field>
                </fieldset>
              ))}
            </div>
          </section>

          <section className="profile-card" id="application">
            <div className="card-heading"><span className="card-icon"><Settings2 /></span><div><h2>Application defaults</h2><p>Answers that frequently appear in job applications.</p></div></div>
            <div className="form-grid">
              <Field label="Years of experience"><select defaultValue=""><option value="" disabled>Select experience</option><option>Less than 1 year</option><option>1–2 years</option><option>3–5 years</option><option>6–9 years</option><option>10+ years</option></select></Field>
              <Field label="Notice period"><select defaultValue=""><option value="" disabled>Select notice period</option><option>Immediately available</option><option>15 days</option><option>30 days</option><option>60 days</option><option>90 days</option></select></Field>
              <Field label="Authorized to work in India?"><select defaultValue=""><option value="" disabled>Select an answer</option><option>Yes</option><option>No</option></select></Field>
              <Field label="Require visa sponsorship?"><select defaultValue=""><option value="" disabled>Select an answer</option><option>Yes</option><option>No</option><option>Not sure</option></select></Field>
              <Field label="Expected annual salary" hint="Optional — leave blank if you prefer to answer per job."><input placeholder="e.g. ₹18,00,000" /></Field>
              <Field label="Preferred work arrangement"><select defaultValue=""><option value="" disabled>Select preference</option><option>Remote</option><option>Hybrid</option><option>On-site</option><option>Open to any</option></select></Field>
            </div>
          </section>

          <section className="profile-card sensitive-card" id="voluntary">
            <div className="card-heading"><span className="card-icon warm"><ShieldCheck /></span><div><h2>Voluntary information</h2><p>Some employers ask equal-opportunity questions. These answers are optional and are never used for job matching.</p></div></div>
            <div className="privacy-banner"><ShieldCheck /><div><strong>You control these answers</strong><p>Question wording varies by employer and country. JobCopilot will only suggest saved answers when you enable it, and you must review them before submission.</p></div></div>
            <div className="form-grid">
              <Field label="Gender identity"><select defaultValue="prefer"><option value="prefer">Prefer not to say</option><option>Woman</option><option>Man</option><option>Non-binary</option><option>Self-describe during application</option></select></Field>
              <Field label="Sexual orientation"><select defaultValue="prefer"><option value="prefer">Prefer not to say</option><option>Heterosexual / straight</option><option>Gay or lesbian</option><option>Bisexual</option><option>Self-describe during application</option></select></Field>
              <Field label="Race or ethnicity"><select defaultValue="prefer"><option value="prefer">Prefer not to say</option><option>Answer during each application</option><option>Use a saved custom answer</option></select></Field>
              <Field label="Disability status"><select defaultValue="prefer"><option value="prefer">Prefer not to say</option><option>Yes</option><option>No</option></select></Field>
              <Field label="Veteran status"><select defaultValue="prefer"><option value="prefer">Prefer not to say</option><option>Veteran</option><option>Not a veteran</option><option>Not applicable</option></select></Field>
            </div>
            <label className="consent-row"><input type="checkbox" checked={allowSensitiveAnswers} onChange={(event) => setAllowSensitiveAnswers(event.target.checked)} /><span><strong>Allow JobCopilot to suggest these answers</strong><small>Keep this off to answer voluntary demographic questions manually every time.</small></span></label>
          </section>

          <div className="profile-savebar"><span><ShieldCheck /> Stored locally on this device</span><button className="button primary" type="submit">Save profile</button></div>
          {saved && <div className="save-toast" role="status"><Check /> Profile saved locally</div>}
        </form>
      </main>
    </div>
  )
}

function DashboardPage({ profile, onProfile, onHome }: { profile: ProfileSeed; onProfile: () => void; onHome: () => void }) {
  const [tab, setTab] = useState<DashboardTab>('discover')
  const [jobUrl, setJobUrl] = useState('')
  const [automationRun, setAutomationRun] = useState<AutomationRun | null>(null)
  const [automationError, setAutomationError] = useState('')
  const [automationLoading, setAutomationLoading] = useState(false)
  const [autoSubmit, setAutoSubmit] = useState(false)
  const [testMode, setTestMode] = useState(false)
  const [applicationRuns, setApplicationRuns] = useState<AutomationRun[]>([])
  const [applicationFilter, setApplicationFilter] = useState<'all' | 'applied' | 'active' | 'attention' | 'failed'>('all')
  const [supportedJobBoards, setSupportedJobBoards] = useState<string[]>([])
  const [jobs, setJobs] = useState<RecommendedJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsLoadingMore, setJobsLoadingMore] = useState(false)
  const [jobsHasMore, setJobsHasMore] = useState(false)
  const [jobsMatchingTotal, setJobsMatchingTotal] = useState(0)
  const [jobsError, setJobsError] = useState('')
  const [jobSourceCount, setJobSourceCount] = useState(0)
  const [totalJobCount, setTotalJobCount] = useState(0)
  const [jobTotalsByBoard, setJobTotalsByBoard] = useState<Partial<Record<RecommendedJob['source'], number>>>({})
  const [savedJobs, setSavedJobs] = useState<RecommendedJob[]>([])
  const [savingJobIds, setSavingJobIds] = useState<Set<string>>(new Set())
  const [saveMessage, setSaveMessage] = useState('')
  const [jobSearch, setJobSearch] = useState('')
  const [jobBoard, setJobBoard] = useState<'all' | RecommendedJob['source']>('all')
  const [jobFilter, setJobFilter] = useState<'newest' | 'remote' | 'saved'>('newest')
  const [visibleJobLimit, setVisibleJobLimit] = useState(24)
  const [resume, setResume] = useState<StoredProfile['resume']>(null)
  const [resumeReview, setResumeReview] = useState<ResumeReview | null>(null)
  const [resumeReviewLoading, setResumeReviewLoading] = useState(false)
  const [resumeReviewError, setResumeReviewError] = useState('')
  const [resumeJobUrl, setResumeJobUrl] = useState('')
  const [resumeTargetJob, setResumeTargetJob] = useState<ResumeTargetJob | null>(null)
  const [resumeOptimizationMode, setResumeOptimizationMode] = useState<'off' | 'review'>('review')
  const [resumeOptimization, setResumeOptimization] = useState<ResumeOptimization | null>(null)
  const [resumeOptimizationLoading, setResumeOptimizationLoading] = useState(false)
  const [resumeOptimizationError, setResumeOptimizationError] = useState('')
  const jobSearchRef = useRef<HTMLInputElement>(null)
  const initials = profile.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  const todayLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())

  const jobsRequestPath = (offset: number) => {
    const parameters = new URLSearchParams({ offset: String(offset), limit: '24', board: jobBoard, remote: String(jobFilter === 'remote') })
    if (jobSearch.trim()) parameters.set('q', jobSearch.trim())
    return `/api/jobs/recommended?${parameters}`
  }

  useEffect(() => {
    if (jobFilter === 'saved') { setJobsLoading(false); return }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setJobsLoading(true); setJobsError(''); setJobs([]); setJobsHasMore(false)
      apiRequest<JobsResponse>(jobsRequestPath(0), { cache: 'no-store' })
        .then((result) => {
          if (cancelled) return
          setJobs(result.data.jobs); setJobsHasMore(result.data.pagination.hasMore); setJobsMatchingTotal(result.data.pagination.total)
          setJobSourceCount(result.data.sources.filter((source) => source.jobs > 0).length)
          setTotalJobCount(result.data.sources.reduce((total, source) => total + source.jobs, 0))
          setJobTotalsByBoard(Object.fromEntries(result.data.sources.map((source) => [source.source, source.jobs])))
        })
        .catch((error) => { if (!cancelled) setJobsError(error instanceof Error ? error.message : 'Could not load jobs.') })
        .finally(() => { if (!cancelled) setJobsLoading(false) })
    }, jobSearch.trim() ? 250 : 0)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [jobBoard, jobFilter, jobSearch])

  useEffect(() => {
    apiRequest<{ data: { jobs: RecommendedJob[] } }>('/api/jobs/saved')
      .then((result) => setSavedJobs(result.data.jobs))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    apiRequest<{ data: { runs: AutomationRun[] } }>('/api/automation/runs').then((result) => setApplicationRuns(result.data.runs)).catch(() => undefined)
    apiRequest<{ data: { boards: string[] } }>('/api/automation/boards').then((result) => setSupportedJobBoards(result.data.boards)).catch(() => undefined)
    apiRequest<{ data: { profile: StoredProfile } }>('/api/profile').then((result) => setResume(result.data.profile.resume)).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (automationRun) setApplicationRuns((runs) => [automationRun, ...runs.filter((run) => run.id !== automationRun.id)])
  }, [automationRun])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setTab('discover'); window.setTimeout(() => jobSearchRef.current?.focus()) } }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const normalizedJobSearch = jobSearch.trim().toLowerCase()
  const filteredSavedJobs = savedJobs.filter((job) => (jobBoard === 'all' || job.source === jobBoard) && (!normalizedJobSearch || [job.title, job.company, job.location, job.department, job.source, job.workplaceType, job.employmentType, ...job.skills].filter(Boolean).join(' ').toLowerCase().includes(normalizedJobSearch)))
  const visibleJobs = jobFilter === 'saved' ? filteredSavedJobs : jobs
  const displayedJobs = jobFilter === 'saved' ? visibleJobs.slice(0, visibleJobLimit) : visibleJobs
  const displayedOpenRoleCount = jobBoard === 'all' ? totalJobCount : jobTotalsByBoard[jobBoard] || 0
  const submittedRunCount = applicationRuns.filter((run) => run.status === 'SUBMITTED').length
  const actionableRunCount = applicationRuns.filter((run) => ['PAUSED_BY_USER', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA', 'READY_FOR_REVIEW'].includes(run.status)).length
  const runStatus = (status: AutomationRun['status']) => status === 'SUBMITTED' ? ['Applied', 'applied'] : status === 'READY_FOR_REVIEW' ? ['Ready for review', 'review'] : status.startsWith('PAUSED_') ? ['Needs input', 'review'] : status === 'FAILED' ? ['Failed', 'failed'] : ['In progress', 'draft']
  const applicationGroups = {
    applied: (run: AutomationRun) => run.status === 'SUBMITTED',
    active: (run: AutomationRun) => ['QUEUED', 'OPENING_JOB', 'EXTRACTING_JOB', 'FILLING_APPLICATION', 'SUBMITTING'].includes(run.status),
    attention: (run: AutomationRun) => ['PAUSED_BY_USER', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA', 'READY_FOR_REVIEW'].includes(run.status),
    failed: (run: AutomationRun) => run.status === 'FAILED',
  }
  const filteredApplicationRuns = applicationFilter === 'all' ? applicationRuns : applicationRuns.filter(applicationGroups[applicationFilter])
  const selectJobFilter = (filter: 'newest' | 'remote' | 'saved') => { setJobFilter(filter); setVisibleJobLimit(24) }
  const loadMoreJobs = async () => {
    if (jobFilter === 'saved') { setVisibleJobLimit((limit) => Math.min(limit + 24, visibleJobs.length)); return }
    if (!jobsHasMore || jobsLoadingMore) return
    setJobsLoadingMore(true); setJobsError('')
    try {
      const result = await apiRequest<JobsResponse>(jobsRequestPath(jobs.length), { cache: 'no-store' })
      setJobs((current) => [...current, ...result.data.jobs.filter((job) => !current.some((existing) => existing.id === job.id))])
      setJobsHasMore(result.data.pagination.hasMore); setJobsMatchingTotal(result.data.pagination.total)
    } catch (error) { setJobsError(error instanceof Error ? error.message : 'Could not load more jobs.') }
    finally { setJobsLoadingMore(false) }
  }
  const toggleSavedJob = async (job: RecommendedJob) => {
    if (savingJobIds.has(job.id)) return
    const isSaved = savedJobs.some((savedJob) => savedJob.id === job.id)
    setSavingJobIds((ids) => new Set(ids).add(job.id)); setSaveMessage('')
    try {
      if (isSaved) {
        await apiRequest<void>('/api/jobs/saved', { method: 'DELETE', body: JSON.stringify({ jobId: job.id }) })
        setSavedJobs((saved) => saved.filter((savedJob) => savedJob.id !== job.id))
        setSaveMessage('Role removed from saved jobs.')
      } else {
        await apiRequest('/api/jobs/saved', { method: 'PUT', body: JSON.stringify(job) })
        setSavedJobs((saved) => [job, ...saved.filter((savedJob) => savedJob.id !== job.id)])
        setSaveMessage('Role saved.')
      }
    } catch (error) { setSaveMessage(error instanceof Error ? error.message : 'Could not update saved jobs.') }
    finally { setSavingJobIds((ids) => { const next = new Set(ids); next.delete(job.id); return next }) }
  }

  useEffect(() => {
    if (!automationRun || ['PAUSED_BY_USER', 'PAUSED_NEEDS_INPUT', 'PAUSED_LOGIN', 'PAUSED_CAPTCHA', 'READY_FOR_REVIEW', 'SUBMITTED', 'FAILED'].includes(automationRun.status)) return
    const timer = window.setInterval(async () => {
      try {
        const result = await apiRequest<{ data: { run: AutomationRun } }>(`/api/automation/runs/${automationRun.id}`)
        setAutomationRun(result.data.run)
      } catch (error) { setAutomationError(error instanceof Error ? error.message : 'Could not read the automation status.') }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [automationRun?.id, automationRun?.status])

  const startAutomation = async (url = jobUrl) => {
    const normalizedUrl = url.trim()
    if (!normalizedUrl || automationLoading) return
    if (!testMode && autoSubmit && !window.confirm('Auto-submit will send the completed application to the employer without a final review step. Continue?')) return
    setAutomationError(''); setAutomationLoading(true)
    try {
      const result = await apiRequest<{ data: { run: AutomationRun } }>('/api/automation/runs', { method: 'POST', body: JSON.stringify({ jobUrl: normalizedUrl, autoSubmit: testMode ? false : autoSubmit, testMode }) })
      setAutomationRun(result.data.run)
    } catch (error) { setAutomationError(error instanceof Error ? error.message : 'Could not start the application.') }
    finally { setAutomationLoading(false) }
  }

  const pauseAutomation = async () => {
    if (!automationRun) return
    setAutomationError(''); setAutomationLoading(true)
    try {
      const result = await apiRequest<{ data: { run: AutomationRun } }>(`/api/automation/runs/${automationRun.id}/pause`, { method: 'POST' })
      setAutomationRun(result.data.run)
    } catch (error) { setAutomationError(error instanceof Error ? error.message : 'Could not pause the automation.') }
    finally { setAutomationLoading(false) }
  }

  const continueAutomation = async () => {
    if (!automationRun) return
    setAutomationError(''); setAutomationLoading(true)
    try {
      const result = await apiRequest<{ data: { run: AutomationRun } }>(`/api/automation/runs/${automationRun.id}/resume`, { method: 'POST' })
      setAutomationRun(result.data.run)
    } catch (error) { setAutomationError(error instanceof Error ? error.message : 'Could not continue the application.') }
    finally { setAutomationLoading(false) }
  }

  const submitAutomation = async () => {
    if (!automationRun || !window.confirm('Submit this application to the employer? This cannot be undone.')) return
    setAutomationError(''); setAutomationLoading(true)
    try {
      const result = await apiRequest<{ data: { run: AutomationRun } }>(`/api/automation/runs/${automationRun.id}/submit`, { method: 'POST' })
      setAutomationRun(result.data.run)
    } catch (error) { setAutomationError(error instanceof Error ? error.message : 'Could not submit the application.') }
    finally { setAutomationLoading(false) }
  }

  const getResumeTips = async (jobUrl?: string) => {
    if (!resume || resumeReviewLoading) return
    setResumeReviewLoading(true); setResumeReviewError('')
    try {
      const result = await apiRequest<{ data: { review: ResumeReview; job: ResumeTargetJob | null } }>('/api/profile/resume/review', { method: 'POST', body: JSON.stringify(jobUrl ? { jobUrl: jobUrl.trim() } : {}) })
      setResumeReview(result.data.review); setResumeTargetJob(result.data.job)
    } catch (error) { setResumeReviewError(error instanceof Error ? error.message : 'Could not review your resume.') }
    finally { setResumeReviewLoading(false) }
  }

  const createResumeOptimization = async () => {
    if (!resumeJobUrl.trim() || resumeOptimizationMode === 'off' || resumeOptimizationLoading) return
    setResumeOptimizationLoading(true); setResumeOptimizationError('')
    try {
      const result = await apiRequest<{ data: { optimization: ResumeOptimization } }>('/api/profile/resume/optimize', { method: 'POST', body: JSON.stringify({ jobUrl: resumeJobUrl.trim(), mode: 'review' }) })
      setResumeOptimization(result.data.optimization)
    } catch (error) { setResumeOptimizationError(error instanceof Error ? error.message : 'Could not create a tailored resume.') }
    finally { setResumeOptimizationLoading(false) }
  }

  const approveResumeOptimization = async () => {
    if (!resumeOptimization || resumeOptimization.status === 'APPROVED') return
    setResumeOptimizationLoading(true); setResumeOptimizationError('')
    try {
      await apiRequest(`/api/profile/resume/optimizations/${resumeOptimization.id}/approve`, { method: 'POST' })
      setResumeOptimization({ ...resumeOptimization, status: 'APPROVED' })
    } catch (error) { setResumeOptimizationError(error instanceof Error ? error.message : 'Could not approve this tailored resume.') }
    finally { setResumeOptimizationLoading(false) }
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <button className="logo logo-button dashboard-logo" onClick={onHome}><span className="logo-mark"><BriefcaseBusiness size={18} /></span><span>Job<span>Copilot</span></span></button>
        <nav aria-label="Dashboard navigation">
          <button className={tab === 'discover' && jobFilter !== 'saved' ? 'active' : ''} onClick={() => { setTab('discover'); selectJobFilter('newest') }}><Compass /> Discover jobs</button>
          <button className={tab === 'discover' && jobFilter === 'saved' ? 'active' : ''} onClick={() => { setTab('discover'); selectJobFilter('saved') }}><Bookmark /> Saved jobs <span className="nav-count">{savedJobs.length}</span></button>
          <button className={tab === 'resume' ? 'active' : ''} onClick={() => setTab('resume')}><FileSearch /> Resume review</button>
          <button className={tab === 'auto-apply' ? 'active' : ''} onClick={() => setTab('auto-apply')}><Bot /> Auto apply</button>
          <button className={tab === 'applications' ? 'active' : ''} onClick={() => setTab('applications')}><FileCheck2 /> Applications <span className="nav-count">{applicationRuns.length}</span></button>
        </nav>
        <div className="sidebar-spacer" />
        <button className="sidebar-profile" onClick={onProfile}><span className="profile-avatar">{initials}</span><span><b>{profile.name}</b><small>Edit profile</small></span><ArrowRight /></button>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <button className="mobile-dashboard-brand" type="button" onClick={onHome} aria-label="Go to JobCopilot home"><BriefcaseBusiness /><b>JobCopilot</b></button>
          <div className="global-search"><Search /><input ref={jobSearchRef} type="search" aria-label="Search jobs, companies, or skills" value={jobSearch} onChange={(event) => { setJobSearch(event.target.value); setVisibleJobLimit(24); setTab('discover') }} placeholder="Search jobs, companies, or skills" /><kbd>⌘ K</kbd></div>
          <button className="icon-button notification-button" aria-label={`${actionableRunCount} applications need attention`} onClick={() => setTab('applications')}>{actionableRunCount > 0 && <span>{actionableRunCount}</span>}<History /></button>
          <button className="profile-avatar dashboard-avatar" onClick={onProfile}>{initials}</button>
        </header>

        <div className="dashboard-content">
          {tab === 'discover' && (
            <>
              <section className="dashboard-welcome"><div><p className="eyebrow">{todayLabel}</p><h1>Good morning, {profile.name.split(' ')[0]}.</h1><p>Here are roles that look promising for you.</p></div><button className="button primary" onClick={() => setTab('auto-apply')}><Link2 /> Apply from a job link</button></section>
              <section className="stats-row" aria-label="Job search summary">
                <article><span className="stat-icon purple"><Sparkles /></span><div><strong>{jobsLoading ? '—' : displayedOpenRoleCount.toLocaleString()}</strong><small>{jobBoard === 'all' ? 'Total open roles' : `${jobBoard[0].toUpperCase() + jobBoard.slice(1)} roles`}</small></div><em>{jobBoard === 'all' ? (jobSourceCount ? `From ${jobSourceCount} job boards` : 'Live job feeds') : `From ${jobBoard}`}</em></article>
                <article><span className="stat-icon green"><FileCheck2 /></span><div><strong>{applicationRuns.length}</strong><small>Applications</small></div><em>{submittedRunCount} submitted</em></article>
                <article><span className="stat-icon orange"><Bookmark /></span><div><strong>{savedJobs.length}</strong><small>Saved roles</small></div><em>{savedJobs.length ? 'Ready to revisit' : 'Save roles to compare'}</em></article>
              </section>
              <section className="dashboard-section-header"><div><h2>Recommended for you</h2><p>Live openings from Ashby, Greenhouse, Lever, and Workable</p></div><div className="job-discovery-filters"><label className="job-board-filter"><span>Job board</span><select value={jobBoard} onChange={(event) => { setJobBoard(event.target.value as typeof jobBoard); setJobFilter('newest'); setVisibleJobLimit(24) }}><option value="all">All boards</option><option value="ashby">Ashby</option><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="workable">Workable</option></select></label><div className="job-filter-pills"><button className={jobFilter === 'newest' ? 'active' : ''} onClick={() => selectJobFilter('newest')}>Newest</button><button className={jobFilter === 'remote' ? 'active' : ''} onClick={() => selectJobFilter('remote')}>Remote</button><button className={jobFilter === 'saved' ? 'active' : ''} onClick={() => selectJobFilter('saved')}>Saved ({savedJobs.length})</button></div></div></section>
              <div className="dashboard-job-list">
                {saveMessage && <p className="save-job-message" role="status">{saveMessage}</p>}
                {jobsLoading && <p className="jobs-message" role="status">Loading live jobs…</p>}
                {jobsError && <p className="jobs-message error" role="alert">{jobsError}</p>}
                {!jobsLoading && !jobsError && !visibleJobs.length && <p className="jobs-message">{normalizedJobSearch ? `No roles match “${jobSearch.trim()}” on ${jobBoard === 'all' ? 'the selected boards' : jobBoard}. Try another title, company, location, or skill.` : jobFilter === 'saved' ? `You have no saved roles${jobBoard === 'all' ? '' : ` from ${jobBoard}`}.` : `No ${jobFilter === 'remote' ? 'remote ' : ''}roles are available from ${jobBoard === 'all' ? 'the selected boards' : jobBoard} right now.`}</p>}
                {displayedJobs.map((job, index) => (
                  <article className="dashboard-job-card" key={job.id}>
                    <span className="dashboard-company-logo" style={{ background: ['#5e6ad2', '#3866e8', '#e95820', '#1e8e6e'][index % 4] }}>{job.company[0]}</span>
                    <div className="dashboard-job-info"><div className="job-title-row"><h3>{job.title}</h3>{job.workplaceType === 'Remote' && <span className="match-badge"><Sparkles /> Remote</span>}</div><p>{job.company} <span>·</span> <MapPin /> {job.location} <span>·</span> {job.employmentType}</p><div className="skill-tags"><span>{job.source[0].toUpperCase() + job.source.slice(1)}</span>{job.skills.map((skill) => <span key={skill}>{skill}</span>)}</div></div>
                    <div className="job-card-actions"><button className={`icon-button save-job-button ${savedJobs.some((savedJob) => savedJob.id === job.id) ? 'saved' : ''}`} disabled={savingJobIds.has(job.id)} aria-pressed={savedJobs.some((savedJob) => savedJob.id === job.id)} aria-label={`${savedJobs.some((savedJob) => savedJob.id === job.id) ? 'Remove' : 'Save'} ${job.title} at ${job.company}`} onClick={() => void toggleSavedJob(job)}><Bookmark /></button><strong>{job.salary || job.department || 'Open role'}</strong><a className="button secondary" href={job.jobUrl} target="_blank" rel="noreferrer">View role <ArrowRight /></a></div>
                  </article>
                ))}
                {((jobFilter === 'saved' && visibleJobLimit < visibleJobs.length) || (jobFilter !== 'saved' && jobsHasMore)) && <button className="button secondary jobs-load-more" disabled={jobsLoadingMore} onClick={() => void loadMoreJobs()}>{jobsLoadingMore ? 'Loading…' : `Load more roles (${displayedJobs.length} of ${jobFilter === 'saved' ? visibleJobs.length : jobsMatchingTotal})`} <ChevronDown /></button>}
              </div>
            </>
          )}

          {tab === 'resume' && (
            <section className="resume-review-page">
              <div className="dashboard-page-title"><p className="eyebrow">Resume optimization</p><h1>Review your resume</h1><p>See the resume attached to applications and get practical, AI-powered suggestions to improve it.</p></div>
              {!resume ? <div className="resume-empty"><FileSearch /><h2>No resume uploaded yet</h2><p>Add a PDF or DOCX resume to your profile before requesting a review.</p><button className="button primary" onClick={onProfile}>Upload resume <ArrowRight /></button></div> : <>
                <div className="resume-review-grid">
                  <article className="resume-preview-card"><div className="resume-card-heading"><div><span className="resume-file-icon"><FileCheck2 /></span><span><b>{resume.filename}</b><small>{resume.mime.includes('pdf') ? 'PDF resume' : 'Document resume'}</small></span></div><a className="button secondary" href="/api/profile/resume/file" target="_blank" rel="noreferrer">Open resume <ExternalLink /></a></div>{resume.mime.includes('pdf') ? <iframe title={`Preview of ${resume.filename}`} src="/api/profile/resume/file#toolbar=1&navpanes=0" /> : <div className="document-preview"><FileCheck2 /><p>Preview opens in a new tab for this document format.</p></div>}</article>
                  <aside className="resume-analysis-card"><span className="large-feature-icon"><Sparkles /></span><h2>Optimization tips</h2><p>Our local AI checks clarity, impact, ATS readability, structure, and achievement language.</p><button className="button primary full" disabled={resumeReviewLoading} onClick={() => void getResumeTips()}>{resumeReviewLoading ? 'Reviewing your resume…' : resumeReview && !resumeTargetJob ? 'Review again' : 'Get general tips'} <Sparkles /></button>{resumeReviewError && <p className="automation-error" role="alert">{resumeReviewError}</p>}</aside>
                </div>
                <section className="job-tailor-card"><div className="job-tailor-copy"><span className="large-feature-icon"><Target /></span><div><p className="eyebrow">Target a specific role</p><h2>Score and tailor your resume</h2><p>Paste a supported job link. JobCopilot will compare the requirements and suggest truthful, job-specific changes.</p></div></div><div className="optimization-mode" role="radiogroup" aria-label="Resume optimization mode">{([['off', 'Off', 'Only show the match analysis.'], ['review', 'Review first', 'Show suggested changes for your approval.']] as const).map(([value, label, copy]) => <button type="button" role="radio" aria-checked={resumeOptimizationMode === value} className={resumeOptimizationMode === value ? 'active' : ''} key={value} onClick={() => { setResumeOptimizationMode(value); setResumeOptimization(null) }}><span>{resumeOptimizationMode === value && <Check />}</span><b>{label}</b><small>{copy}</small></button>)}</div><div className="job-tailor-workspace"><div><label className="url-input job-review-url"><Link2 /><input type="url" value={resumeJobUrl} onChange={(event) => { setResumeJobUrl(event.target.value); setResumeOptimization(null) }} placeholder="Paste an Ashby, Greenhouse, Lever, Workable, or other supported job link" /></label><button className="button primary full" disabled={!resumeJobUrl.trim() || resumeReviewLoading} onClick={() => void getResumeTips(resumeJobUrl)}>{resumeReviewLoading && resumeJobUrl ? 'Reading job and comparing…' : 'Analyze job match'} <Target /></button>{resumeOptimizationMode === 'review' && <button className="button secondary full optimize-resume-button" disabled={!resumeJobUrl.trim() || resumeOptimizationLoading} onClick={() => void createResumeOptimization()}>{resumeOptimizationLoading ? 'Preparing suggestions…' : resumeOptimization ? 'Regenerate suggestions' : 'Show suggested changes'} <Sparkles /></button>}{resumeOptimizationError && <p className="automation-error" role="alert">{resumeOptimizationError}</p>}</div>{resumeTargetJob ? <article className="target-job-preview"><span><b>{resumeTargetJob.title}</b><small>{resumeTargetJob.company}{resumeTargetJob.location ? ` · ${resumeTargetJob.location}` : ''}</small></span><p>{resumeTargetJob.description}</p><a href={resumeTargetJob.url} target="_blank" rel="noreferrer">Open job posting <ExternalLink /></a></article> : <div className="target-job-placeholder"><Target /><p>The role and its requirements will appear here beside your analysis.</p></div>}</div></section>
                {resumeReview && <section className="resume-report"><div className="resume-score"><span style={{ '--score': `${resumeReview.score * 3.6}deg` } as React.CSSProperties}><b>{resumeReview.score}</b><small>/100</small></span><div><p className="eyebrow">{resumeTargetJob ? `Match score for ${resumeTargetJob.title}` : 'Resume score'}</p><h2>{resumeReview.score >= 80 ? 'Strong foundation' : resumeReview.score >= 65 ? 'Good, with room to improve' : 'Needs focused improvements'}</h2><p>{resumeReview.summary}</p></div></div>{resumeTargetJob && ((resumeReview.matchedKeywords?.length || 0) > 0 || (resumeReview.missingKeywords?.length || 0) > 0) && <div className="resume-keyword-groups"><div><b>Matched requirements</b><span>{resumeReview.matchedKeywords?.map((keyword) => <em key={keyword}>{keyword}</em>)}</span></div><div><b>Gaps to address truthfully</b><span>{resumeReview.missingKeywords?.map((keyword) => <em key={keyword}>{keyword}</em>)}</span></div></div>}<div className="resume-report-columns"><div><h3><Check /> What already works</h3><ul className="resume-strengths">{resumeReview.strengths.map((strength) => <li key={strength}>{strength}</li>)}</ul></div><div><h3><Sparkles /> Recommended improvements</h3><div className="resume-tips">{resumeReview.tips.map((tip, index) => <article key={`${tip.title}-${index}`}><span className={`tip-priority ${tip.priority}`}>{tip.priority}</span><div><b>{tip.title}</b><p>{tip.detail}</p></div></article>)}</div></div></div></section>}
                {resumeOptimization && <section className="optimization-proposal"><div className="optimization-summary"><div><p className="eyebrow">Suggested resume changes</p><h2>{resumeOptimization.proposal.headline}</h2><p>Review each suggestion below. Your original resume remains unchanged.</p></div><div className="score-improvement"><span>{resumeOptimization.proposal.originalScore}</span><ArrowRight /><strong>{resumeOptimization.proposal.optimizedScore}</strong></div></div><div className="resume-change-list">{resumeOptimization.proposal.changes.map((change, index) => <article key={`${change.section}-${index}`}><header><span>{index + 1}</span><div><b>{change.section}</b><small>{change.reason}</small></div></header><div><section><em>Original</em><p>{change.before}</p></section><ArrowRight /><section><em>Suggested</em><p>{change.after}</p></section></div></article>)}</div><div className="optimization-actions">{resumeOptimization.status === 'DRAFT' ? <button className="button primary" disabled={resumeOptimizationLoading} onClick={() => void approveResumeOptimization()}><ShieldCheck /> Approve suggested changes</button> : <><span className="approved-draft"><BadgeCheck /> Suggestions approved</span><a className="button secondary" href={`/api/profile/resume/optimizations/${resumeOptimization.id}/download`}><FileDown /> Download Word resume</a></>}<small>No changes are made to your original uploaded resume.</small></div></section>}
              </>}
            </section>
          )}

          {tab === 'auto-apply' && (
            <section className="auto-apply-page">
              <div className="dashboard-page-title"><p className="eyebrow">Guided automation</p><h1>Apply from a job link</h1><p>Paste a supported job URL. JobCopilot will read the role, prepare your answers, and pause for your review.</p></div>
              <label className="consent-row testing-mode-toggle"><input type="checkbox" checked={testMode} onChange={(event) => { setTestMode(event.target.checked); if (event.target.checked) setAutoSubmit(false) }} /><span><strong>Testing mode</strong><small>Allows test answers so you can watch the complete filling flow. Submission is always disabled.</small></span></label>
              <div className="auto-apply-grid">
                <div className="paste-link-card"><span className="large-feature-icon"><Link2 /></span><h2>Paste the job posting URL</h2><p>Automation starts immediately when you paste a valid link. A visible Chrome window will open.</p><div className="submission-mode" role="radiogroup" aria-label="Submission mode"><button type="button" role="radio" aria-checked={!autoSubmit} className={!autoSubmit ? 'active' : ''} onClick={() => setAutoSubmit(false)}><ShieldCheck /><span><b>Submit with approval</b><small>Review the completed form before sending.</small></span></button><button type="button" role="radio" aria-checked={autoSubmit} className={autoSubmit ? 'active' : ''} onClick={() => setAutoSubmit(true)}><Send /><span><b>Auto-submit</b><small>Send automatically when filling is complete.</small></span></button></div><label className="url-input"><Link2 /><input type="url" value={jobUrl} onChange={(event) => setJobUrl(event.target.value)} onPaste={(event) => { const pastedUrl = event.clipboardData.getData('text').trim(); if (!pastedUrl) return; event.preventDefault(); setJobUrl(pastedUrl); void startAutomation(pastedUrl) }} placeholder="https://jobs.lever.co/company/job-id/apply" /></label><button className="button primary large full" disabled={!jobUrl || automationLoading} onClick={() => void startAutomation()}>{automationLoading ? 'Starting…' : 'Start application'} <ArrowRight /></button><div className="supported-sites"><span>Available now</span>{supportedJobBoards.map((board) => <b key={board}>{board === 'bamboohr' ? 'BambooHR' : board[0].toUpperCase() + board.slice(1)}</b>)}</div>
                  {automationError && <p className="automation-error" role="alert">{automationError}</p>}
                  {automationRun && <div className={`automation-run ${automationRun.status.toLowerCase()}`} role="status"><div className="automation-run-heading"><span><b>{automationRun.job?.jobTitle || 'Job application'}</b><small>{automationRun.job?.company || automationRun.currentStep.replaceAll('_', ' ')}</small></span><div className="automation-run-heading-actions"><em>{automationRun.status.replaceAll('_', ' ')}</em>{['QUEUED', 'OPENING_JOB', 'EXTRACTING_JOB', 'FILLING_APPLICATION'].includes(automationRun.status) && <button className="automation-pause-button" type="button" disabled={automationLoading || !automationRun.browserActive} onClick={pauseAutomation}><Pause /> Pause</button>}</div></div>{automationRun.pause && <div className="automation-pause"><strong>{automationRun.pause.question?.text || (automationRun.status === 'PAUSED_BY_USER' ? 'Automation paused' : 'Your action is needed')}</strong><p>{automationRun.pause.reason}</p><small>{automationRun.pause.instruction}</small><button className="button primary" disabled={automationLoading || !automationRun.browserActive} onClick={continueAutomation}>Continue automation <ArrowRight /></button></div>}{automationRun.status === 'READY_FOR_REVIEW' && <div className="automation-ready"><ShieldCheck /><div><strong>Ready for your final review</strong><p>Review every answer in Chrome, then submit when ready.</p>{automationRun.error && <p className="automation-error">{automationRun.error}</p>}<button className="button primary automation-submit-button" disabled={automationLoading || !automationRun.browserActive} onClick={submitAutomation}>{automationLoading ? 'Submitting…' : 'Submit application'} <Send /></button></div></div>}{automationRun.status === 'SUBMITTING' && <div className="automation-ready"><ShieldCheck /><div><strong>Submitting application…</strong><p>Please keep the automation browser open.</p></div></div>}{automationRun.status === 'SUBMITTED' && <div className="automation-ready automation-submitted"><ShieldCheck /><div><strong>Application submitted</strong><p>The job board confirmed your application was received.</p></div></div>}{automationRun.status === 'FAILED' && <p className="automation-error">{automationRun.error}</p>}{automationRun.events?.length ? <ul className="automation-event-list">{automationRun.events.slice(-4).reverse().map((item, index) => <li key={`${item.createdAt}-${index}`}>{item.message}</li>)}</ul> : null}</div>}
                </div>
                <aside className="automation-steps"><h3>What happens next</h3><ol><li className="active"><span>1</span><div><b>Read the job</b><small>Extract role details and application questions.</small></div></li><li><span>2</span><div><b>Prepare answers</b><small>Use your profile and default resume.</small></div></li><li><span>3</span><div><b>{autoSubmit ? 'Automatic checks' : 'You review'}</b><small>{autoSubmit ? 'Validate required fields and visible choices.' : 'Confirm every answer before continuing.'}</small></div></li><li><span>4</span><div><b>{autoSubmit ? 'Auto-submit' : 'Submit with approval'}</b><small>{autoSubmit ? 'Send after the form is completely prepared.' : 'The final action stays with you.'}</small></div></li></ol><div className="local-safety"><ShieldCheck /><span><b>Runs on your device</b><small>Your browser session and files remain local.</small></span></div></aside>
              </div>
            </section>
          )}

          {tab === 'applications' && (
            <section>
              <div className="application-heading"><div className="dashboard-page-title"><p className="eyebrow">Application tracker</p><h1>Your applications</h1><p>Keep every role and its current status in one place.</p></div><div className="job-filter-pills application-filters" aria-label="Filter applications"><button className={applicationFilter === 'all' ? 'active' : ''} onClick={() => setApplicationFilter('all')}>All ({applicationRuns.length})</button><button className={applicationFilter === 'applied' ? 'active' : ''} onClick={() => setApplicationFilter('applied')}>Applied ({applicationRuns.filter(applicationGroups.applied).length})</button><button className={applicationFilter === 'active' ? 'active' : ''} onClick={() => setApplicationFilter('active')}>In progress ({applicationRuns.filter(applicationGroups.active).length})</button><button className={applicationFilter === 'attention' ? 'active' : ''} onClick={() => setApplicationFilter('attention')}>Needs input ({applicationRuns.filter(applicationGroups.attention).length})</button><button className={applicationFilter === 'failed' ? 'active' : ''} onClick={() => setApplicationFilter('failed')}>Failed ({applicationRuns.filter(applicationGroups.failed).length})</button></div></div>
              {!filteredApplicationRuns.length ? <p className="jobs-message">{applicationRuns.length ? 'No applications match this status.' : 'No applications yet. Start one from a job link and it will appear here automatically.'}</p> : <div className="application-table-wrap"><table><thead><tr><th>Role</th><th>Date</th><th>Status</th><th>Board</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
                {filteredApplicationRuns.map((run, index) => { const [label, statusClass] = runStatus(run.status); const company = run.job?.company || run.jobBoard; const title = run.job?.jobTitle || 'Job application'; return <tr key={run.id}><td><span className="table-company"><i style={{background:['#5e6ad2','#3866e8','#e95820','#1e8e6e'][index % 4]}}>{company[0]?.toUpperCase()}</i><span><b>{title}</b><small>{company}</small></span></span></td><td>{new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(new Date(run.createdAt))}</td><td><span className={`table-status ${statusClass}`}>{label}</span></td><td>{run.jobBoard}</td><td><a className="icon-button" href={run.jobUrl} target="_blank" rel="noreferrer" aria-label={`Open ${title}`}><ExternalLink /></a></td></tr> })}
              </tbody></table></div>}
            </section>
          )}
        </div>

        <nav className="mobile-dashboard-nav" aria-label="Mobile dashboard navigation">
          <button className={tab === 'discover' && jobFilter !== 'saved' ? 'active' : ''} onClick={() => { setTab('discover'); selectJobFilter('newest') }}><Compass /><span>Discover</span></button>
          <button className={tab === 'discover' && jobFilter === 'saved' ? 'active' : ''} onClick={() => { setTab('discover'); selectJobFilter('saved') }}><Bookmark /><span>Saved</span></button>
          <button className={tab === 'resume' ? 'active' : ''} onClick={() => setTab('resume')}><FileSearch /><span>Resume</span></button>
          <button className={tab === 'auto-apply' ? 'active' : ''} onClick={() => setTab('auto-apply')}><Send /><span>Apply</span></button>
          <button className={tab === 'applications' ? 'active' : ''} onClick={() => setTab('applications')}><FileCheck2 /><span>History</span></button>
          <button onClick={onProfile}><UserRound /><span>Profile</span></button>
        </nav>
      </main>
    </div>
  )
}

function App() {
  const [authMode, setAuthMode] = useState<AuthMode>(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [page, setPage] = useState<'landing' | 'profile' | 'dashboard'>('landing')
  const [profile, setProfile] = useState<ProfileSeed>({ name: 'Aryan Singh', email: '' })

  useEffect(() => {
    apiRequest<{ data: { user: ProfileSeed } }>('/api/auth/me')
      .then((result) => { setProfile(result.data.user); setPage('dashboard') })
      .catch(() => undefined)
  }, [])

  if (page === 'profile') return <ProfilePage onHome={() => setPage('landing')} onComplete={() => setPage('dashboard')} profile={profile} />
  if (page === 'dashboard') return <DashboardPage profile={profile} onProfile={() => setPage('profile')} onHome={() => setPage('landing')} />

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header" id="top">
        <nav className="nav container" aria-label="Main navigation">
          <Logo />
          <div className={`nav-links ${mobileMenu ? 'open' : ''}`}>
            <a href="#how" onClick={() => setMobileMenu(false)}>How it works</a>
            <a href="#features" onClick={() => setMobileMenu(false)}>Features</a>
            <a href="#safety" onClick={() => setMobileMenu(false)}>Your control</a>
          </div>
          <div className="nav-actions">
            <button className="button ghost desktop-action" onClick={() => setAuthMode('login')}>Log in</button>
            <button className="button primary desktop-action" onClick={() => setAuthMode('signup')}>Get started <ArrowRight size={16} /></button>
            <button className="icon-button menu-button" onClick={() => setMobileMenu(!mobileMenu)} aria-expanded={mobileMenu} aria-label="Toggle navigation">
              {mobileMenu ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </nav>
      </header>

      <main id="main">
        <section className="hero">
          <div className="hero-glow glow-one" />
          <div className="hero-glow glow-two" />
          <div className="container hero-grid">
            <div className="hero-copy">
              <div className="pill"><Sparkles size={15} /> Your personal job-search copilot</div>
              <h1>Less searching.<br /><span>More good interviews.</span></h1>
              <p className="hero-lead">Discover roles that actually fit and move through applications with guided browser automation—while you stay in control.</p>
              <div className="hero-actions">
                <button className="button primary large" onClick={() => setAuthMode('signup')}>Start finding roles <ArrowRight size={18} /></button>
                <a className="button secondary large" href="#how">See how it works <ChevronDown size={17} /></a>
              </div>
              <div className="trust-row">
                <span><Check size={15} /> Free and local</span>
                <span><Check size={15} /> Review before applying</span>
                <span><Check size={15} /> No noisy job feed</span>
              </div>
            </div>

            <div className="product-scene" aria-label="Preview of the JobCopilot dashboard">
              <div className="float-card match-float"><span className="float-icon"><BadgeCheck size={18} /></span><div><b>Strong match</b><small>Based on your preferences</small></div></div>
              <div className="app-window">
                <div className="window-top"><span className="mini-logo"><BriefcaseBusiness size={15} /></span><span className="window-title">JobCopilot</span><div className="window-search"><Search size={13} /> Search roles</div><span className="avatar">AS</span></div>
                <div className="window-body">
                  <aside className="window-sidebar">
                    <span className="active"><Compass size={14} /> Discover</span>
                    <span><Link2 size={14} /> Auto apply</span>
                    <span><FileCheck2 size={14} /> Applications</span>
                  </aside>
                  <div className="job-content">
                    <div className="content-heading"><div><small>GOOD MORNING</small><strong>Roles picked for you</strong></div><span>12 new</span></div>
                    <div className="filter-row"><span>Frontend</span><span>Remote</span><span>Last 7 days</span></div>
                    <div className="role-list">
                      {roles.map((role, index) => (
                        <div className={`role-card ${index === 0 ? 'selected' : ''}`} key={role.company}>
                          <span className="company-logo" style={{ background: role.color }}>{role.company[0]}</span>
                          <div className="role-copy"><b>{role.role}</b><span>{role.company} · {role.meta}</span></div>
                          <strong>{role.match}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="float-card applied-float"><span className="float-icon success"><Check size={18} /></span><div><b>Ready to review</b><small>Application prepared</small></div></div>
            </div>
          </div>
          <div className="trusted container"><span>Built for a focused search</span><div><span>React</span><span>Playwright</span><span>Local-first</span><span>Private by design</span></div></div>
        </section>

        <section className="section how" id="how">
          <div className="container">
            <div className="section-heading centered"><p className="eyebrow">How it works</p><h2>A clear path from search to submitted</h2><p>Job hunting has enough uncertainty. The workflow shouldn’t add more.</p></div>
            <div className="steps-grid">
              {steps.map(({ icon: Icon, number, title, copy }) => (
                <article className="step-card" key={number}>
                  <span className="step-number">{number}</span><span className="step-icon"><Icon size={23} /></span>
                  <h3>{title}</h3><p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section features" id="features">
          <div className="container feature-grid">
            <div className="feature-copy"><p className="eyebrow">Relevant by default</p><h2>Your job feed, minus the noise.</h2><p>Skip endless tabs and generic recommendations. JobCopilot keeps the roles that fit your direction in one calm workspace.</p>
              <ul className="check-list"><li><Check /> Preferences that stay remembered</li><li><Check /> Clear match signals, not mystery scores</li><li><Check /> One place for saved and applied roles</li></ul>
            </div>
            <div className="feature-visual">
              <div className="search-card"><div className="search-top"><Search size={18} /><span>Product engineer roles</span><kbd>⌘ K</kbd></div><div className="search-filters"><span>Remote</span><span>2–5 years</span><span>React</span><button>+ Add filter</button></div></div>
              <div className="insight-card"><div className="insight-label"><Sparkles size={15} /> Why this matches</div><p>Strong overlap with your React experience and preference for product-focused teams.</p><div className="meter"><span /></div><div className="meter-label"><span>Your fit</span><strong>Excellent</strong></div></div>
            </div>
          </div>
        </section>

        <section className="section control" id="safety">
          <div className="container control-grid">
            <div className="apply-visual">
              <div className="browser-bar"><i /><i /><i /><span>jobs.example.com/apply</span></div>
              <div className="apply-body"><div className="apply-head"><span className="company-logo blue">J</span><div><small>APPLICATION</small><b>Frontend Engineer</b></div><span className="status-pill">Ready to review</span></div>
                <div className="progress"><span /><span /><span /><span className="muted" /></div>
                <div className="review-row"><span><FileCheck2 /> Resume</span><b>aryan-resume.pdf</b><Check /></div>
                <div className="review-row"><span><Clock3 /> Availability</span><b>Immediately</b><Check /></div>
                <button className="button primary full">Review application <ArrowRight size={17} /></button>
              </div>
            </div>
            <div className="feature-copy"><p className="eyebrow">Automation with boundaries</p><h2>It handles repetition.<br />You make the decisions.</h2><p>JobCopilot can fill the repetitive parts of an application, but it never needs to take the final decision away from you.</p>
              <ul className="check-list"><li><ShieldCheck /> Review before any submission</li><li><BadgeCheck /> Pause for unexpected questions</li><li><Link2 /> Browser sessions remain on your device</li></ul>
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="container cta-card"><div className="cta-spark spark-a"><Sparkles /></div><div className="cta-spark spark-b"><Sparkles /></div><p className="eyebrow light">Your next role is out there</p><h2>Make the search feel manageable again.</h2><p>Start with your preferences. Let JobCopilot help with the rest.</p><button className="button light-button large" onClick={() => setAuthMode('signup')}>Create your account <ArrowRight size={18} /></button></div>
        </section>
      </main>

      <footer><div className="container footer-inner"><Logo /><p>Built for a more focused job search.</p><div><a href="#safety">Privacy</a><a href="#how">How it works</a></div></div></footer>
      {authMode && <AuthModal mode={authMode} onClose={() => setAuthMode(null)} onSwitch={setAuthMode} onComplete={(nextProfile, isNew) => { setProfile(nextProfile); setAuthMode(null); setPage(isNew ? 'profile' : 'dashboard') }} />}
    </>
  )
}

export default App
