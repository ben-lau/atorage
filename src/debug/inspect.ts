import type { Driver } from '../types.js';
import { unwrap } from '../core/wrap.js';

export interface InspectResult {
  exists: boolean;
  raw: unknown;
  value: unknown;
  meta: Record<string, unknown>;
}

export async function inspect(driver: Driver, key: string): Promise<InspectResult> {
  const raw = await driver.get(key);
  if (raw === undefined) {
    return { exists: false, raw: undefined, value: undefined, meta: {} };
  }
  const { value, meta } = unwrap(raw);
  return { exists: true, raw, value, meta };
}
