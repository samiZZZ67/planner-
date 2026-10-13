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
  postingTime: string;
  timezone: string;
  currentPage: number;
  status: 'draft' | 'paused';
  extractionStatus: 'pending';
  extractionMessage: string;
  createdAt: number;
  updatedAt: number;
}
