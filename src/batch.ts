import type { Driver } from './types';
import { eventBus } from './core/event-bus';

interface DeferredBusNotify {
  sourceAtomId: string;
  sourceDrivers: Driver[];
  event: { type: string; value?: unknown };
}

interface BatchContext {
  deferredEvents: Map<string, { atom: EventTarget; event: Event }>;
  deferredBusNotify: Map<string, DeferredBusNotify>;
}

let currentBatch: BatchContext | null = null;

export function isBatching(): boolean {
  return currentBatch !== null;
}

export function deferEvent(
  atomKey: string,
  atomId: string,
  target: EventTarget,
  event: Event,
): void {
  if (!currentBatch) return;
  currentBatch.deferredEvents.set(`${atomId}:${atomKey}`, { atom: target, event });
}

export function deferBusNotify(
  atomKey: string,
  sourceAtomId: string,
  sourceDrivers: Driver[],
  event: { type: string; value?: unknown },
): void {
  if (!currentBatch) return;
  currentBatch.deferredBusNotify.set(`${sourceAtomId}:${atomKey}`, {
    sourceAtomId,
    sourceDrivers,
    event,
  });
}

export async function batch(fn: () => Promise<void> | void): Promise<void> {
  if (currentBatch) {
    await fn();
    return;
  }

  currentBatch = {
    deferredEvents: new Map(),
    deferredBusNotify: new Map(),
  };

  try {
    await fn();
  } finally {
    const events = currentBatch.deferredEvents;
    const busNotify = currentBatch.deferredBusNotify;
    currentBatch = null;

    for (const [key, { sourceAtomId, sourceDrivers, event }] of busNotify) {
      try {
        const atomKey = key.substring(sourceAtomId.length + 1);
        eventBus.notify(atomKey, sourceAtomId, sourceDrivers, event);
      } catch {
        /* swallow listener errors, consistent with non-batch path */
      }
    }

    for (const [, { atom, event }] of events) {
      try {
        atom.dispatchEvent(event);
      } catch {
        /* swallow listener errors, consistent with non-batch path */
      }
    }
  }
}
