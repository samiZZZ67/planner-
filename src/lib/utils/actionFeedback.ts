export type ActionFeedbackStatus = 'pending' | 'success' | 'error';

export interface ActionFeedbackEventDetail {
  id: string;
  status: ActionFeedbackStatus;
  message: string;
}

const inFlight = new WeakSet<HTMLElement>();

function emit(detail: ActionFeedbackEventDetail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('samsspace:action-feedback', { detail }));
}

/** Wrap a user action with shared progress, completion, and duplicate-submit feedback. */
export async function withActionFeedback<T>(
  label: string,
  action: () => Promise<T> | T,
  source?: HTMLElement | null,
): Promise<T | undefined> {
  const key = source || document.body;
  if (inFlight.has(key)) return undefined;
  inFlight.add(key);

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const controls: Array<{ element: HTMLButtonElement | HTMLInputElement; disabled: boolean }> = [];
  const targets = source instanceof HTMLFormElement
    ? Array.from(source.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button[type="submit"], input[type="submit"]'))
    : source instanceof HTMLButtonElement || source instanceof HTMLInputElement ? [source] : [];
  for (const element of targets) {
    controls.push({ element, disabled: element.disabled });
    element.disabled = true;
    element.setAttribute('aria-busy', 'true');
  }

  emit({ id, status: 'pending', message: label });
  try {
    const result = await action();
    emit({ id, status: 'success', message: `${label} complete.` });
    return result;
  } catch (error) {
    emit({ id, status: 'error', message: error instanceof Error ? error.message : `${label} failed.` });
    return undefined;
  } finally {
    inFlight.delete(key);
    for (const { element, disabled } of controls) {
      if (!element.isConnected) continue;
      element.disabled = disabled;
      element.removeAttribute('aria-busy');
    }
  }
}
