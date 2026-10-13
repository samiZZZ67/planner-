import { randomUUID } from 'node:crypto';
import { sendChatCompletionWithFallback } from './freellm/gateway';
import { getGatewayConfig } from './freellm/gateway';
import type { BookAssignmentRecord, BookConcept, BookPageRecord, BookRecord } from '../books/types';

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

export async function generateConceptReadingPlan(options: {
  book: BookRecord;
  pages: BookPageRecord[];
  model?: string;
}) {
  const { book, pages } = options;
  const expectedCount = book.endPage - book.startPage + 1;
  if (pages.length !== expectedCount || pages[0]?.pdfPage !== book.startPage || pages[pages.length - 1]?.pdfPage !== book.endPage) {
    throw new Error('Extracted page text is incomplete for the selected range. Re-extract the PDF before planning.');
  }
  const unreadable = pages.filter(page => page.method === 'empty' || !page.text.trim());
  if (unreadable.length) throw new Error(`Pages ${unreadable.map(page => page.pdfPage).join(', ')} have no readable text. Resolve them before generating a plan.`);
  const uncheckedOcr = pages.filter(page => page.requiresReview && !page.reviewedByUser);
  if (uncheckedOcr.length) throw new Error(`Review OCR pages ${uncheckedOcr.map(page => page.pdfPage).join(', ')} against the PDF before generating a plan.`);

  const model = options.model?.trim() || getGatewayConfig().defaultModel || 'auto';
  let sections: PlannedSection[] = [];
  const batches = pageBatches(pages);
  for (const batch of batches) {
    const result = await sendChatCompletionWithFallback({
      model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: 'Analyze only the supplied page text. Identify coherent concepts, chapter or section boundaries, and how difficult each concept is to study. Do not rewrite or reproduce the source text. Return only valid JSON: {"sections":[{"startPage":number,"endPage":number,"title":"...","concept":"...","estimatedMinutes":number}]}. The sections must partition every supplied PDF page exactly once, in order, and must not split an explanation mid-concept. Estimate minutes for careful reading of the source pages.' },
        { role: 'user', content: JSON.stringify({ book: { title: book.title, author: book.author }, pages: batch.map(page => ({ pdfPage: page.pdfPage, text: page.text })) }) },
      ],
    });
    sections.push(...validateChunkSections(parseJson(result.content), batch, sections.length + 1));
  }

  const sectionSummary = sections.map(({ id, startPage, endPage, title, concept, estimatedMinutes }) => ({ id, startPage, endPage, title, concept, estimatedMinutes }));
  const planResult = await sendChatCompletionWithFallback({
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: 'Create a concept-based daily reading schedule from the supplied ordered sections. Group meaningful sections according to conceptual coherence, difficulty, estimated reading time, and the daily study budget. Never distribute by equal page count. Keep section order, use each section exactly once, and assign days within the requested duration. Return only JSON: {"days":[{"dayNumber":number,"sectionIds":["section-1"],"rationale":"why these concepts belong together"}]}. Omit dates; the application adds dates. If the requested duration or daily time budget is not realistic, still return a complete proposed schedule and explain the issue in a top-level "scheduleIssue" string.' },
      { role: 'user', content: JSON.stringify({ durationDays: book.durationDays, studyMinutesPerDay: book.studyMinutes || 60, startDate: book.startDate, pageRange: [book.startPage, book.endPage], sections: sectionSummary }) },
    ],
  });
  const rawPlan = parseJson(planResult.content);
  const validatedPlan = validateDayGroups(rawPlan, sections, book.durationDays, book.studyMinutes || 60);
  const scheduleIssue = String(rawPlan.scheduleIssue || '').trim().slice(0, 1000);
  const now = Date.now();
  const assignments: BookAssignmentRecord[] = validatedPlan.days.map((day: any) => {
    const concepts = day.sections.map((section: PlannedSection) => ({ title: section.title, concept: section.concept, estimatedMinutes: section.estimatedMinutes }));
    const startPdfPage = day.sections[0].startPage;
    const endPdfPage = day.sections[day.sections.length - 1].endPage;
    return {
      id: randomUUID(), userId: book.userId, bookId: book.id,
      dayNumber: day.dayNumber, scheduledDate: plusDays(book.startDate || new Date().toISOString().slice(0, 10), day.dayNumber - 1),
      startPdfPage, endPdfPage, concepts,
      estimatedMinutes: day.estimatedMinutes,
      rationale: day.rationale,
      status: 'draft',
      updatedAt: now,
    };
  });
  return { assignments, issues: [...validatedPlan.issues, ...(scheduleIssue ? [scheduleIssue] : [])], model: planResult.model, provider: planResult.providerUsed };
}
