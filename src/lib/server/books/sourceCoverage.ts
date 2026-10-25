import type { BookAssignmentRecord, BookPageRecord } from '../../books/types';

/** Returns every missing or duplicated PDF page in an assignment's source range. */
export function getAssignmentSourceIssues(
  assignment: Pick<BookAssignmentRecord, 'startPdfPage' | 'endPdfPage'>,
  pages: BookPageRecord[],
): number[] {
  const counts = new Map<number, number>();
  for (const page of pages) counts.set(page.pdfPage, (counts.get(page.pdfPage) || 0) + 1);

  const issues: number[] = [];
  for (let page = assignment.startPdfPage; page <= assignment.endPdfPage; page += 1) {
    if (counts.get(page) !== 1) issues.push(page);
  }
  return issues;
}

export function orderCompleteAssignmentPages(
  assignment: Pick<BookAssignmentRecord, 'bookId' | 'startPdfPage' | 'endPdfPage'>,
  pages: BookPageRecord[],
): BookPageRecord[] {
  const foreignBookPages = pages.filter(page => page.bookId !== assignment.bookId);
  if (foreignBookPages.length) {
    throw new Error(`The supplied source includes pages from another book. Use only book ${assignment.bookId}'s extracted pages.`);
  }
  const issues = getAssignmentSourceIssues(assignment, pages);
  if (issues.length) {
    throw new Error(`The original source is incomplete for PDF pages ${assignment.startPdfPage}-${assignment.endPdfPage}. Missing or duplicated pages: ${issues.join(', ')}. Re-run extraction before generating or delivering study materials.`);
  }

  const unexpected = pages.filter(page => page.pdfPage < assignment.startPdfPage || page.pdfPage > assignment.endPdfPage);
  if (unexpected.length) {
    throw new Error(`The supplied source includes unassigned PDF pages: ${unexpected.map(page => page.pdfPage).sort((a, b) => a - b).join(', ')}. Use only pages ${assignment.startPdfPage}-${assignment.endPdfPage} for this study unit.`);
  }

  const ordered = [...pages].sort((a, b) => a.pdfPage - b.pdfPage);
  const unreviewed = ordered.filter(page => page.method === 'ocr' && page.text?.trim() && page.requiresReview && !page.reviewedByUser);
  if (unreviewed.length) {
    throw new Error(`The original source includes OCR pages awaiting OCR review (visual review required): ${unreviewed.map(page => page.pdfPage).join(', ')}. Review them before generating or delivering study materials.`);
  }
  return ordered;
}
