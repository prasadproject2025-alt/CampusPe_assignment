import fs from 'fs';
import path from 'path';
import { CandidateProfile } from '../src/automation/types';

export function getMockCandidate(id: string = 'cand_alex_01'): CandidateProfile {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const resumePath = path.join(dataDir, 'Alex_Rivera_Resume.pdf');
  if (!fs.existsSync(resumePath)) {
    // Generate mock resume PDF or text file
    const sampleResumeContent = `%PDF-1.4
%
1 0 obj
<< /Title (Alex Rivera - Resume) /Author (Alex Rivera) >>
endobj
2 0 obj
<< /Type /Catalog /Pages 3 0 R >>
endobj
3 0 obj
<< /Type /Pages /Kids [4 0 R] /Count 1 >>
endobj
4 0 obj
<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
5 0 obj
<< /Length 120 >>
stream
BT
/F1 18 Tf
50 720 Td
(Alex Rivera - Senior Full Stack Engineer) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000015 00000 n
0000000084 00000 n
0000000133 00000 n
0000000192 00000 n
0000000281 00000 n
trailer
<< /Size 6 /Root 2 0 R >>
startxref
453
%%EOF`;
    fs.writeFileSync(resumePath, sampleResumeContent, 'utf-8');
  }

  return {
    candidateId: id,
    personalInfo: {
      fullName: 'Alex Rivera',
      email: `${id}@campuspe-candidate.org`,
      phone: '+91 98765 43210',
      location: 'Bangalore, Karnataka, India',
      linkedIn: 'https://linkedin.com/in/alex-rivera-swe',
      portfolio: 'https://github.com/alexrivera-dev'
    },
    education: {
      degree: 'B.Tech / B.E. (Computer Science)',
      institution: 'Indian Institute of Technology, Madras',
      fieldOfStudy: 'Computer Science and Engineering',
      graduationYear: '2024',
      gpa: '8.9 / 10.0'
    },
    experience: {
      currentCompany: 'CampusPE Technologies',
      jobTitle: 'Full Stack Engineer',
      yearsOfExperience: '3-5',
      techStack: 'TypeScript, Playwright, Node.js, Express, React, PostgreSQL, Docker',
      responsibilities: 'Architected high-reliability workflow automations and automated verification pipelines for student discovery.'
    },
    resume: {
      filePath: resumePath,
      fileName: 'Alex_Rivera_Resume.pdf'
    }
  };
}
