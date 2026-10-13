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
  scheduledDate: string;
  startPdfPage: number;
  endPdfPage: number;
  concepts: BookConcept[];
  estimatedMinutes: number;
  rationale: string;
  status: 'draft' | 'approved' | 'completed' | 'superseded';
  studyNotes?: BookStudyNotes;
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
