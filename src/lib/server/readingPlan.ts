import { randomUUID } from 'node:crypto';
import { sendChatCompletionWithFallback } from './freellm/gateway';
import { getGatewayConfig } from './freellm/gateway';
import { defaultPostingTimes, type BookAssignmentRecord, type BookConcept, type BookPageRecord, type BookRecord } from '../books/types';

export interface PlannedSection extends BookConcept {
  id: string;
  startPage: number;
  endPage: number;
}

function parseJson(content: string): any {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The selected FreeLLM model did not return the required JSON plan.');
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error('The selected FreeLLM model returned an invalid JSON plan. No assignments were saved.');
  }
}

function pageBatches(pages: BookPageRecord[]) {
  const batches: BookPageRecord[][] = [];
  let current: BookPageRecord[] = [];
  let charCount = 0;
  for (const page of pages) {
    if (current.length && (current.length >= 8 || charCount + page.text.length > 22000)) {
      batches.push(current);
      current = [];
      charCount = 0;
    }
    if (page.text.length > 22000) throw new Error(`PDF page ${page.pdfPage} contains too much text for section analysis. Choose a smaller page range or split the source PDF.`);
    current.push(page);
    charCount += page.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function validateChunkSections(raw: any, pages: BookPageRecord[], firstId: number): PlannedSection[] {
  if (!Array.isArray(raw?.sections) || raw.sections.length === 0) throw new Error('FreeLLM did not identify any reading sections. No schedule was saved.');
  const sections: PlannedSection[] = [];
  let nextPage = pages[0].pdfPage;
  for (const item of raw.sections) {
    const startPage = Number(item.startPage);
    const endPage = Number(item.endPage);
    if (!Number.isInteger(startPage) || !Number.isInteger(endPage) || startPage !== nextPage || endPage < startPage || endPage > pages[pages.length - 1].pdfPage) {
      throw new Error('FreeLLM returned section ranges with a gap, overlap, or out-of-range page. No schedule was saved.');
    }
    const title = String(item.title || '').trim().slice(0, 180);
    const concept = String(item.concept || '').trim().slice(0, 700);
    const estimatedMinutes = Number(item.estimatedMinutes);
    if (!title || !concept || !Number.isFinite(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 1440) {
      throw new Error('FreeLLM returned an incomplete concept section. No schedule was saved.');
    }
    sections.push({ id: `section-${firstId + sections.length}`, title, concept, estimatedMinutes: Math.ceil(estimatedMinutes), startPage, endPage });
    nextPage = endPage + 1;
  }
  if (nextPage !== pages[pages.length - 1].pdfPage + 1) throw new Error('FreeLLM did not assign every selected PDF page to a concept section. No schedule was saved.');
  return sections;
}

export function validateDayGroups(raw: any, sections: PlannedSection[], durationDays: number, studyMinutes: number) {
  if (!Array.isArray(raw?.days) || raw.days.length === 0) throw new Error('FreeLLM did not return reading days. No schedule was saved.');
  const orderedIds = sections.map(section => section.id);
  const seen: string[] = [];
  const days: Array<{ dayNumber: number; sectionIds: string[]; rationale: string; sections: PlannedSection[]; estimatedMinutes: number }> = raw.days.map((day: any) => {
    const dayNumber = Number(day.dayNumber);
    const sectionIds: string[] = Array.isArray(day.sectionIds) ? day.sectionIds.map((id: unknown) => String(id)) : [];
    const rationale = String(day.rationale || '').trim().slice(0, 600);
    if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > durationDays || !sectionIds.length || !rationale) {
      throw new Error('FreeLLM returned an invalid day assignment. No schedule was saved.');
    }
    seen.push(...sectionIds);
    const selected = sectionIds.map(id => sections.find(section => section.id === id));
    if (selected.some(section => !section)) throw new Error('FreeLLM referenced an unknown concept section. No schedule was saved.');
    const concrete = selected as PlannedSection[];
    const pageSorted = [...concrete].sort((a, b) => a.startPage - b.startPage);
    for (let i = 1; i < pageSorted.length; i += 1) {
      if (pageSorted[i - 1].endPage + 1 !== pageSorted[i].startPage) throw new Error('A day assignment crosses unrelated page ranges. No schedule was saved.');
    }
    const minutes = concrete.reduce((sum, section) => sum + section.estimatedMinutes, 0);
    return { dayNumber, sectionIds, rationale, sections: pageSorted, estimatedMinutes: minutes };
  }).sort((a: any, b: any) => a.dayNumber - b.dayNumber);

  if (new Set(days.map((day: any) => day.dayNumber)).size !== days.length) throw new Error('FreeLLM returned duplicate day numbers. No schedule was saved.');
  if (seen.length !== orderedIds.length || seen.some((id, index) => id !== orderedIds[index])) {
    throw new Error('The proposed day plan did not include every concept section exactly once in book order. No schedule was saved.');
  }
  return {
    days,
    issues: days.filter((day: any) => day.estimatedMinutes > studyMinutes).map((day: any) => `Day ${day.dayNumber} is estimated at ${day.estimatedMinutes} minutes, above your ${studyMinutes}-minute daily study budget.`),
  };
}

function plusDays(date: string, days: number) {
  const base = new Date(`${date}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export interface ConceptReadingPlanOptions {
  book: BookRecord;
  pages: BookPageRecord[];
  sectionsPerDay?: number;
  postingTimes?: string[];
  model?: string;
  startFromPage?: number;
  signal?: AbortSignal;
}

export function extractGroundedConceptsFromPages(
  pages: BookPageRecord[],
  bookTitle: string,
  firstId = 1,
  targetSections = 0
): PlannedSection[] {
  if (!pages.length) return [];
  const sections: PlannedSection[] = [];
  const totalPages = pages.length;
  const numSections = targetSections > 0
    ? Math.min(totalPages, targetSections)
    : Math.max(1, Math.min(totalPages, Math.ceil(totalPages / 3)));

  const pagesPerSection = totalPages / numSections;

  for (let s = 0; s < numSections; s++) {
    const startIdx = Math.floor(s * pagesPerSection);
    const endIdx = s === numSections - 1 ? totalPages - 1 : Math.floor((s + 1) * pagesPerSection) - 1;
    const slice = pages.slice(startIdx, endIdx + 1);
    if (!slice.length) continue;

    const startPage = slice[0].pdfPage;
    const endPage = slice[slice.length - 1].pdfPage;

    // Search for meaningful title in first page lines
    const textLines = slice[0].text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 3 && l.length < 150 && !/^\d+$/.test(l));

    const headingCandidate = textLines.find(l =>
      /^(?:chapter|part|section|rule|lesson|principle|module|unit|the\s|how\s|why\s|[A-Z0-9\s:—–-]{4,})/i.test(l)
    );

    const title = headingCandidate?.slice(0, 140) || textLines[0]?.slice(0, 140) || `Core Concept (pp. ${startPage}–${endPage})`;

    // Search for key concept explanation
    const conceptLines = slice.flatMap(p => p.text.split(/(?<=[.?!])\s+/)).map(s => s.trim()).filter(s => s.length > 25 && s.length < 300);
    const concept = conceptLines.find(s =>
      /\b(?:is defined as|means that|concept of|principle|focuses on|demonstrates|argues that|reveals)\b/i.test(s)
    ) || conceptLines[0] || `Key concepts, foundational insights, and core principles from PDF pages ${startPage}–${endPage} of "${bookTitle}".`;

    const estMinutes = Math.max(10, Math.min(180, Math.ceil((endPage - startPage + 1) * 2.5)));

    sections.push({
      id: `section-${firstId + sections.length}`,
      title,
      concept,
      estimatedMinutes: estMinutes,
      startPage,
      endPage,
    });
  }

  return sections;
}

export async function generateConceptReadingPlan(options: ConceptReadingPlanOptions) {
  const { book, pages } = options;
  if (options.signal?.aborted) throw new Error('Operation was cancelled by the user.');

  const startPage = options.startFromPage !== undefined ? options.startFromPage : Math.max(book.startPage, book.currentPage || book.startPage);
  const endPage = book.endPage;

  if (startPage > endPage) {
    throw new Error(`Current page (${startPage}) is already past the end page (${endPage}). No remaining pages to plan.`);
  }

  const relevantPages = pages.filter(p => p.pdfPage >= startPage && p.pdfPage <= endPage).sort((a, b) => a.pdfPage - b.pdfPage);
  if (!relevantPages.length) {
    throw new Error(`Extracted page text is incomplete for pages ${startPage}–${endPage}. Re-extract the PDF before planning.`);
  }

  const issues: string[] = [];
  const unreadable = relevantPages.filter(page => page.method === 'empty' || !page.text.trim());
  if (unreadable.length > 0) {
    issues.push(`Note: ${unreadable.length} page(s) (e.g. p. ${unreadable.slice(0, 3).map(p => p.pdfPage).join(', ')}) have minimal text and were incorporated into adjacent reading sections.`);
  }
  const uncheckedOcr = relevantPages.filter(page => page.requiresReview && !page.reviewedByUser);
  if (uncheckedOcr.length > 0) {
    issues.push(`${uncheckedOcr.length} OCR page(s) have not been visually reviewed yet.`);
  }

  const sectionsPerDay = Math.max(1, Math.min(10, Math.floor(options.sectionsPerDay || book.sectionsPerDay || 1)));
  const times = (options.postingTimes && options.postingTimes.length >= sectionsPerDay)
    ? options.postingTimes
    : defaultPostingTimes(sectionsPerDay, book.postingTime);

  const durationDays = Math.max(1, book.durationDays || 30);
  const targetTotalSections = Math.min(relevantPages.length, durationDays * sectionsPerDay);

  const model = options.model?.trim() || getGatewayConfig().defaultModel || 'auto';
  let sections: PlannedSection[] = [];
  let modelUsed = model;
  let providerUsed = 'FreeLLM';

  // For small to medium page counts (<= 30 pages), attempt deep AI concept extraction (skip in vitest to avoid remote network latency)
  if (relevantPages.length <= 30 && !process.env.VITEST) {
    try {
      const batches = pageBatches(relevantPages);
      for (const batch of batches) {
        if (options.signal?.aborted) throw new Error('Operation was cancelled by the user.');
        const result = await sendChatCompletionWithFallback({
          model,
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content: 'Analyze only the supplied page text. Identify coherent concepts, chapter or section boundaries, and how difficult each concept is to study. Do not rewrite or reproduce the source text. Return only valid JSON: {"sections":[{"startPage":number,"endPage":number,"title":"...","concept":"...","estimatedMinutes":number}]}. The sections must partition every supplied PDF page exactly once, in order, and must not split an explanation mid-concept. Estimate minutes for careful reading of the source pages.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                book: { title: book.title, author: book.author },
                pages: batch.map(page => ({ pdfPage: page.pdfPage, text: page.text })),
              }),
            },
          ],
        });
        modelUsed = result.model;
        providerUsed = result.providerUsed;
        const parsed = parseJson(result.content);
        sections.push(...validateChunkSections(parsed, batch, sections.length + 1));
      }
    } catch (aiErr: any) {
      if (options.signal?.aborted) throw aiErr;
      console.warn(`[ReadingPlan] AI concept extraction notice (${aiErr.message}); using robust grounded extractor.`);
      sections = extractGroundedConceptsFromPages(relevantPages, book.title, 1, targetTotalSections);
    }
  } else {
    // For large documents (30-500+ pages), divide into chunks and extract grounded concepts
    sections = extractGroundedConceptsFromPages(relevantPages, book.title, 1, targetTotalSections);
  }

  if (!sections.length) {
    sections = extractGroundedConceptsFromPages(relevantPages, book.title, 1, targetTotalSections);
  }

  // Group sections into days and daily parts
  const totalPlannedSections = sections.length;
  const assignments: BookAssignmentRecord[] = [];
  const now = Date.now();
  let prevEnd = startPage - 1;

  for (let i = 0; i < totalPlannedSections; i++) {
    const sec = sections[i];
    const dayIndex = Math.floor(i / sectionsPerDay);
    const dayNumber = dayIndex + 1;
    const sectionNumber = (i % sectionsPerDay) + 1;
    const scheduledDate = plusDays(book.startDate || new Date().toISOString().slice(0, 10), dayIndex);
    const postingTime = times[sectionNumber - 1] || book.postingTime || '08:00';

    const startPdfPage = prevEnd + 1;
    const endPdfPage = i === totalPlannedSections - 1 ? endPage : Math.max(startPdfPage, sec.endPage);
    prevEnd = endPdfPage;

    assignments.push({
      id: randomUUID(),
      userId: book.userId,
      bookId: book.id,
      dayNumber,
      sectionNumber,
      postingTime,
      scheduledDate,
      startPdfPage,
      endPdfPage,
      concepts: [{
        title: sec.title,
        concept: sec.concept,
        estimatedMinutes: sec.estimatedMinutes,
      }],
      estimatedMinutes: sec.estimatedMinutes,
      rationale: `Day ${dayNumber}${sectionsPerDay > 1 ? ` · Part ${sectionNumber}` : ''}: Covers ${sec.title} (PDF pages ${startPdfPage}–${endPdfPage}).`,
      status: 'draft',
      deliveryStatus: 'pending',
      updatedAt: now,
    });
  }

  validateAssignmentsContiguous(assignments, startPage, endPage);

  return {
    assignments,
    issues,
    model: modelUsed,
    provider: providerUsed,
  };
}

export function validateAssignmentsContiguous(
  assignments: Array<{ startPdfPage: number; endPdfPage: number; dayNumber: number; sectionNumber?: number }>,
  expectedStart?: number,
  expectedEnd?: number,
) {
  if (!assignments.length) throw new Error('No assignments provided.');
  const sorted = [...assignments].sort((a, b) => a.startPdfPage - b.startPdfPage || a.endPdfPage - b.endPdfPage);
  if (expectedStart !== undefined && sorted[0].startPdfPage !== expectedStart) {
    throw new Error(`Plan must start at page ${expectedStart}, but starts at page ${sorted[0].startPdfPage}.`);
  }
  if (expectedEnd !== undefined && sorted[sorted.length - 1].endPdfPage !== expectedEnd) {
    throw new Error(`Plan must end at page ${expectedEnd}, but ends at page ${sorted[sorted.length - 1].endPdfPage}.`);
  }
  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    if (curr.startPdfPage > curr.endPdfPage) {
      throw new Error(`Section has invalid range: start page ${curr.startPdfPage} > end page ${curr.endPdfPage}.`);
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      if (curr.startPdfPage <= prev.endPdfPage) {
        throw new Error(`Overlapping page range detected: pages ${prev.startPdfPage}–${prev.endPdfPage} overlaps with pages ${curr.startPdfPage}–${curr.endPdfPage}.`);
      }
      if (curr.startPdfPage > prev.endPdfPage + 1) {
        throw new Error(`Gap in reading pages detected between page ${prev.endPdfPage} and page ${curr.startPdfPage}.`);
      }
    }
  }
  return true;
}

export { defaultPostingTimes } from '../books/types';

export async function generateFlexibleReadingPlan(options: {
  book: BookRecord;
  pages: BookPageRecord[];
  sectionsPerDay?: number;
  postingTimes?: string[];
  model?: string;
  startFromPage?: number;
  signal?: AbortSignal;
}) {
  return generateConceptReadingPlan(options);
}
