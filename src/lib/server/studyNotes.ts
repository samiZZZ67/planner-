import { sendChatCompletionWithFallback, getGatewayConfig } from './freellm/gateway';
import { sanitizeUtf8 } from './telegramFormatter';
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
  const summary = sanitizeUtf8(String(raw?.summary || '').trim());
  const keyConcepts = Array.isArray(raw?.keyConcepts) ? raw.keyConcepts.map((value: unknown) => sanitizeUtf8(String(value).trim())).filter(Boolean).slice(0, 8) : [];
  const definitions: BookStudyNotes['definitions'] = Array.isArray(raw?.definitions) ? raw.definitions.slice(0, 12).map((item: any) => ({
    term: sanitizeUtf8(String(item?.term || '').trim()), explanation: sanitizeUtf8(String(item?.explanation || '').trim()), pdfPage: Number(item?.pdfPage),
  })) : [];
  const example = {
    situation: sanitizeUtf8(String(raw?.example?.situation || '').trim()),
    conceptInAction: sanitizeUtf8(String(raw?.example?.conceptInAction || '').trim()),
    lesson: sanitizeUtf8(String(raw?.example?.lesson || '').trim()),
    sourceDisclosure: sanitizeUtf8(String(raw?.example?.sourceDisclosure || '').trim()),
    kind: raw?.example?.kind === 'source' ? 'source' as const : 'illustrative' as const,
    ...(Number.isInteger(Number(raw?.example?.pdfPage)) ? { pdfPage: Number(raw.example.pdfPage) } : {}),
  };
  const questions: BookStudyNotes['questions'] = Array.isArray(raw?.questions) ? raw.questions.map((item: any) => ({
    question: sanitizeUtf8(String(item?.question || '').trim()), answer: sanitizeUtf8(String(item?.answer || '').trim()),
    pdfPages: Array.isArray(item?.pdfPages) ? item.pdfPages.map(Number) : [],
  })) : [];
  const notes = sanitizeUtf8(String(raw?.notes || '').trim());
  if (!summary || summary.length > 1600 || keyConcepts.length === 0 || !notes || notes.length > 5000) {
    throw new Error('FreeLLM returned incomplete study notes. No notes were saved.');
  }
  if (definitions.some((item: any) => !item.term || !item.explanation || !inRange(item.pdfPage))) {
    throw new Error('FreeLLM returned a definition with an invalid page citation. No notes were saved.');
  }
  if (!example.situation || !example.conceptInAction || !example.lesson || (example.kind === 'source' ? !inRange(example.pdfPage) || !/source|book|pdf page/i.test(example.sourceDisclosure) : !/hypothetical|illustrative/i.test(example.sourceDisclosure))) {
    throw new Error('Use a page-cited real example from the book, or clearly label a practical application as illustrative. No notes were saved.');
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
  if (!pages.length) {
    throw new Error('The assignment pages are missing.');
  }

  const readablePages = pages.filter(page => page.text?.trim() && page.method !== 'empty');
  if (readablePages.length === 0) {
    const studyNotes: BookStudyNotes = {
      summary: `This section (PDF pages ${assignment.startPdfPage}–${assignment.endPdfPage}) consists of illustration, cover, or blank divider pages without extractable text.`,
      keyConcepts: [`Visual Section (PDF pp. ${assignment.startPdfPage}–${assignment.endPdfPage})`],
      definitions: [],
      example: {
        kind: 'illustrative',
        situation: 'Encountered illustration or blank divider pages during scheduled reading.',
        conceptInAction: 'Visual pages contain illustrations, diagrams, or blank space rather than narrative text.',
        lesson: 'Automatically proceed to the next reading section.',
        sourceDisclosure: 'Illustrative section note',
      },
      questions: [
        {
          question: `What content was identified on PDF pages ${assignment.startPdfPage}–${assignment.endPdfPage}?`,
          answer: 'Blank, cover, or illustration pages with no readable text.',
          pdfPages: [assignment.startPdfPage],
        },
        {
          question: 'What is the recommended next action for this section?',
          answer: 'Automatically advance to the next reading section.',
          pdfPages: [assignment.endPdfPage],
        },
      ],
      notes: `Pages ${assignment.startPdfPage}–${assignment.endPdfPage} are illustration or divider pages. System automatically proceeds to next section.`,
      generatedByModel: 'system-blank-page-handler',
      generatedAt: Date.now(),
    };
    return { studyNotes, model: 'system-blank-page-handler', provider: 'system' };
  }

  if (readablePages.some(page => page.method === 'ocr' && page.requiresReview && !page.reviewedByUser)) {
    throw new Error('The assignment pages contain OCR text that still needs review.');
  }

  const charLength = readablePages.reduce((sum, page) => sum + page.text.length, 0);
  if (charLength > 90000) throw new Error('This assignment contains too much text for one study-note request. Split it into smaller concept assignments first.');
  const model = options.model?.trim() || getGatewayConfig().defaultModel || 'auto';
  const result = await sendChatCompletionWithFallback({
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'Write supplemental study material grounded only in the supplied original page text. Never replace, rewrite, quote extensively from, or insert content into the source reading. Return only valid JSON: {"summary":"concise concept summary","keyConcepts":["..."],"definitions":[{"term":"...","explanation":"...","pdfPage":number}],"example":{"kind":"source or illustrative","situation":"...","conceptInAction":"...","lesson":"...","sourceDisclosure":"...","pdfPage":number},"questions":[{"question":"...","answer":"...","pdfPages":[number]}],"notes":"concise study notes"}. Prefer a real-world case or example explicitly described in the supplied book pages; set kind to source, include its supplied PDF page in pdfPage, and identify it as an example from the source. Never invent details or present an unverified event as fact. If the supplied text has no real case, give a useful practical application of the concept, set kind to illustrative, and disclose that it is hypothetical/illustrative. Include 2 or 3 answerable review questions with source PDF pages. Cite only supplied PDF page numbers.' },
      { role: 'user', content: JSON.stringify({ book: { title: sanitizeUtf8(book.title), author: sanitizeUtf8(book.author || '') }, assignment: { day: assignment.dayNumber, date: assignment.scheduledDate, pageRange: [assignment.startPdfPage, assignment.endPdfPage], concepts: assignment.concepts }, sourcePages: readablePages.map(page => ({ pdfPage: page.pdfPage, text: sanitizeUtf8(page.text) })) }) },
    ],
  });
  const fields = validateStudyNotes(parseJson(result.content), assignment);
  const studyNotes: BookStudyNotes = { ...fields, generatedByModel: result.model, generatedAt: Date.now() };
  return { studyNotes, model: result.model, provider: result.providerUsed };
}
