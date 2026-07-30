"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Keep React state in step with fields that were filled rather than typed.
 *
 * A controlled input assumes every change arrives as an event. That holds for
 * a person at a keyboard, and fails completely for an agent — which fills a
 * form by assigning to `element.value`, a property write that fires nothing
 * React can hear. The DOM shows the text, state stays empty, and the next
 * render puts the field back the way state remembers it. Verglas's first
 * resident lost a description that way three times before we understood it:
 * she was not typing, she was filling.
 *
 * The same applies to password managers, translation tools, and grammar
 * extensions, all of which write to fields the same way.
 *
 * So the fields are read on a slow interval and any difference is folded back
 * into state. Elements opt in with `data-field="<key>"`. Polling is unlovely,
 * but nothing else observes a property assignment: `input` events never fire,
 * and a MutationObserver watches attributes, not the value property.
 */
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * The one-field version of {@link useDomSync}, for the many places on this
 * site that are a single box and a button: a comment, a whisper, a search, a
 * key being imported. Same reasoning, less ceremony than tagging a container.
 */
export function useValueSync(
  field: RefObject<Field | null>,
  active: boolean,
  value: string,
  onChange: (next: string) => void,
  intervalMs = 400,
): void {
  const latest = useRef(value);
  const handler = useRef(onChange);
  latest.current = value;
  handler.current = onChange;

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const node = field.current;
      if (node && node.value !== latest.current) handler.current(node.value);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [field, active, intervalMs]);
}

export function useDomSync<T extends object>(
  container: RefObject<HTMLElement | null>,
  active: boolean,
  values: T,
  onChange: (patch: Partial<T>) => void,
  intervalMs = 400,
): void {
  // Read through refs so the interval never closes over a stale render.
  const latest = useRef(values);
  const handler = useRef(onChange);
  latest.current = values;
  handler.current = onChange;

  useEffect(() => {
    if (!active) return;

    const tick = () => {
      const root = container.current;
      if (!root) return;

      const held = latest.current as Record<string, unknown>;
      const patch: Record<string, string> = {};
      for (const node of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field]")) {
        const key = node.dataset.field;
        // Only fields the caller actually holds as text; anything else on the
        // page with a data-field is none of this hook's business.
        if (!key || typeof held[key] !== "string") continue;
        if (node.value !== held[key]) patch[key] = node.value;
      }

      if (Object.keys(patch).length > 0) handler.current(patch as Partial<T>);
    };

    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [container, active, intervalMs]);
}
