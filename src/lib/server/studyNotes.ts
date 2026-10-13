import { sendChatCompletionWithFallback, getGatewayConfig } from './freellm/gateway';
import type { BookAssignmentRecord, BookPageRecord, BookRecord, BookStudyNotes } from '../books/types';

function parseJson(content: string) {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('FreeLLM did not return study notes as JSON.');
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error('FreeLLM returned invalid study-note JSON. No notes were saved.');
  }
}

export function validateStudyNotes(raw: any, assignment: BookAssignmentRecord): Omit<BookStudyNotes, 'generatedByModel' | 'generatedAt'> {
  const inRange = (page: unknown) => Number.isInteger(Number(page)) && Number(page) >= assignment.startPdfPage && Number(page) <= assignment.endPdfPage;
  const summary = String(raw?.summary || '').trim();
  const keyConcepts = Array.isArray(raw?.keyConcepts) ? raw.keyConcepts.map((value: unknown) => String(value).trim()).filter(Boolean).slice(0, 8) : [];
  const definitions: BookStudyNotes['definitions'] = Array.isArray(raw?.definitions) ? raw.definitions.slice(0, 12).map((item: any) => ({
    term: String(item?.term || '').trim(), explanation: String(item?.explanation || '').trim(), pdfPage: Number(item?.pdfPage),
  })) : [];
  const example = {
    situation: String(raw?.example?.situation || '').trim(),
    conceptInAction: String(raw?.example?.conceptInAction || '').trim(),
    lesson: String(raw?.example?.lesson || '').trim(),
    sourceDisclosure: String(raw?.example?.sourceDisclosure || '').trim(),
  };
  const questions: BookStudyNotes['questions'] = Array.isArray(raw?.questions) ? raw.questions.map((item: any) => ({
    question: String(item?.question || '').trim(), answer: String(item?.answer || '').trim(),
    pdfPages: Array.isArray(item?.pdfPages) ? item.pdfPages.map(Number) : [],
  })) : [];
  const notes = String(raw?.notes || '').trim();
  if (!summary || summary.length > 1600 || keyConcepts.length === 0 || !notes || notes.length > 5000) {
    throw new Error('FreeLLM returned incomplete study notes. No notes were saved.');
  }
  if (definitions.some((item: any) => !item.term || !item.explanation || !inRange(item.pdfPage))) {
    throw new Error('FreeLLM returned a definition with an invalid page citation. No notes were saved.');
  }
  if (!example.situation || !example.conceptInAction || !example.lesson || !/hypothetical/i.test(example.sourceDisclosure)) {
    throw new Error('The example must be complete and clearly disclosed as hypothetical. No notes were saved.');
  }
  if (questions.length < 2 || questions.length > 3 || questions.some(item => !item.question || !item.answer || !item.pdfPages.length || item.pdfPages.some(page => !inRange(page)))) {
    throw new Error('FreeLLM returned review questions without valid source page citations. No notes were saved.');
  }
  return { summary, keyConcepts, definitions, example, questions, notes };
}

export async function generateAssignmentStudyNotes(options: {
  book: BookRecord;
  assignment: BookAssignmentRecord;
  pages: BookPageRecord[];
  model?: string;
}) {
  const { book, assignment, pages } = options;
  if (!pages.length || pages.some(page => page.method === 'empty' || !page.text.trim() || (page.requiresReview && !page.reviewedByUser))) {
    throw new Error('The assignment pages are missing, unreadable, or still need OCR review.');
  }
  const charLength = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (charLength > 90000) throw new Error('This assignment contains too much text for one study-note request. Split it into smaller concept assignments first.');
  const model = options.model?.trim() || getGatewayConfig().defaultModel || 'auto';
  const result = await sendChatCompletionWithFallback({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'Write supplemental study material grounded only in the supplied original page text. Never replace, rewrite, quote extensively from, or insert content into the source reading. Return only valid JSON: {"summary":"concise concept summary","keyConcepts":["..."],"definitions":[{"term":"...","explanation":"...","pdfPage":number}],"example":{"situation":"...","conceptInAction":"...","lesson":"...","sourceDisclosure":"Hypothetical scenario, not a verified event."},"questions":[{"question":"...","answer":"...","pdfPages":[number]}],"notes":"concise study notes"}. Include 2 or 3 answerable review questions with source PDF pages. Any invented real-life example must be explicitly hypothetical. Cite only supplied PDF page numbers.' },
      { role: 'user', content: JSON.stringify({ book: { title: book.title, author: book.author }, assignment: { day: assignment.dayNumber, date: assignment.scheduledDate, pageRange: [assignment.startPdfPage, assignment.endPdfPage], concepts: assignment.concepts }, sourcePages: pages.map(page => ({ pdfPage: page.pdfPage, text: page.text })) }) },
    ],
  });
  const fields = validateStudyNotes(parseJson(result.content), assignment);
  const studyNotes: BookStudyNotes = { ...fields, generatedByModel: result.model, generatedAt: Date.now() };
  return { studyNotes, model: result.model, provider: result.providerUsed };
}
