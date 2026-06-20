interface Wrapped {
  $v: unknown;
  $m?: Record<string, unknown>;
}

interface Unwrapped {
  value: unknown;
  meta: Record<string, unknown>;
}

export function wrap(value: unknown, meta: Record<string, unknown>): Wrapped {
  const v = value === undefined ? null : value;
  if (Object.keys(meta).length === 0) {
    return { $v: v };
  }
  return { $v: v, $m: meta };
}

export function unwrap(stored: unknown): Unwrapped {
  if (stored == null) {
    return { value: undefined, meta: {} };
  }

  if (typeof stored === 'object' && '$v' in stored) {
    const wrapped = stored as Wrapped;
    return { value: wrapped.$v, meta: wrapped.$m ?? {} };
  }

  return { value: stored, meta: {} };
}
