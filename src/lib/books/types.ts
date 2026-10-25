export interface BookRecord {
  id: string;
  userId: string;
  title: string;
  author: string;
  metadata: string;
  originalFilename: string;
  storedFilename: string;
  fileSize: number;
  startPage: number;
  endPage: number;
  durationDays: number;
  startDate: string;
  studyMinutes: number;
  postingTime: string;
  timezone: string;
  currentPage: number;
  status: 'draft' | 'processing' | 'ready' | 'paused';
  extractionStatus: 'pending' | 'processing' | 'completed' | 'needs_review' | 'failed';
  extractionMessage: string;
  extractionProgress?: { completedPages: number; totalPages: number };
  totalPdfPages?: number;
  sectionsPerDay?: number;
  postingTimes?: string[];
  autoPublish?: boolean;
  automationStatus?: 'queued' | 'processing' | 'ready' | 'needs_review' | 'failed';
  automationAttempts?: number;
  automationRetryAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface BookConcept {
  title: string;
  concept: string;
  estimatedMinutes: number;
}

export interface BookAssignmentRecord {
  id: string;
  userId: string;
  bookId: string;
  dayNumber: number;
  sectionNumber?: number;
  postingTime?: string;
  scheduledDate: string;
  startPdfPage: number;
  endPdfPage: number;
  concepts: BookConcept[];
  estimatedMinutes: number;
  rationale: string;
  status: 'draft' | 'approved' | 'completed' | 'superseded';
  deliveryStatus?: 'pending' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled' | 'overdue';
  lastDeliveryError?: string;
  deliveredAt?: number;
  studyNotes?: BookStudyNotes;
  learningPackage?: BookLearningPackage;
  updatedAt: number;
}

export interface QuizQuestionItem {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  conceptTested?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourcePdfPages: number[];
}

export interface LearningPackageRealLifeExample {
  title: string;
  situation: string;
  connection: string;
  sourceTitle: string;
  sourceUrl: string;
  attribution: string;
  kind?: 'source' | 'external' | 'illustrative';
  sourcePdfPages?: number[];
  lesson?: string;
  sourceDisclosure?: string;
}

export interface BookLearningQuote {
  text: string;
  pdfPage: number;
}

export interface PreviousStudyUnitConnection {
  previousAssignmentId: string | null;
  previousTitle: string | null;
  previousPdfPages?: [number, number] | null;
  explanation: string;
}

export interface BookLearningPackage {
  bookId: string;
  assignmentId: string;
  startPdfPage: number;
  endPdfPage: number;
  summary: string;
  keyConcepts: string[];
  definitions?: Array<{ term: string; explanation: string; pdfPage: number }>;
  previousUnitConnection?: PreviousStudyUnitConnection;
  quotes?: BookLearningQuote[];
  realLifeExamples: LearningPackageRealLifeExample[];
  quiz: QuizQuestionItem[];
  status: {
    summary: 'success' | 'failed' | 'pending';
    examples: 'success' | 'failed' | 'pending';
    quiz: 'success' | 'failed' | 'pending';
    error?: string;
  };
  createdAt: number;
  updatedAt: number;
}

export interface BookStudyNotes {
  summary: string;
  keyConcepts: string[];
  definitions: Array<{ term: string; explanation: string; pdfPage: number }>;
  example: { situation: string; conceptInAction: string; lesson: string; sourceDisclosure: string; kind?: 'source' | 'illustrative'; pdfPage?: number };
  questions: Array<{ question: string; answer: string; pdfPages: number[] }>;
  notes: string;
  generatedByModel: string;
  generatedAt: number;
}

export interface BookPageRecord {
  bookId: string;
  pdfPage: number;
  text: string;
  method: 'native' | 'ocr' | 'empty';
  confidence: number | null;
  warnings: string[];
  requiresReview: boolean;
  reviewedByUser?: boolean;
  visualPreview?: { filename: string; mimeType: 'image/jpeg'; width: number; height: number };
  updatedAt: number;
}

export function defaultPostingTimes(sectionsPerDay: number, fallbackTime = '08:00'): string[] {
  if (sectionsPerDay <= 1) return [fallbackTime || '08:00'];
  if (sectionsPerDay === 2) return ['09:00', '18:00'];
  if (sectionsPerDay === 3) return ['08:00', '13:00', '19:00'];
  if (sectionsPerDay === 4) return ['08:00', '12:00', '16:00', '20:00'];
  const times: string[] = [];
  const startHour = 8;
  const endHour = 20;
  const step = (endHour - startHour) / (sectionsPerDay - 1);
  for (let i = 0; i < sectionsPerDay; i++) {
    const h = Math.round(startHour + i * step);
    times.push(`${String(h).padStart(2, '0')}:00`);
  }
  return times;
}
