import type { Driver } from '../types';

export interface SnapshotOptions {
  driver: Driver;
  prefix?: string;
}

export async function snapshot(options: SnapshotOptions): Promise<Record<string, unknown>> {
  const keys = await options.driver.keys(options.prefix);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = await options.driver.get(key);
  }
  return result;
}
