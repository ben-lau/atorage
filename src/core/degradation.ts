import type { Driver } from '../types';
import { StorageError } from '../errors';

export async function degradedGet(
  drivers: Driver[],
  key: string,
  onError?: (error: Error) => void,
): Promise<unknown> {
  const errors: Error[] = [];
  for (const driver of drivers) {
    try {
      const stored = await driver.get(key);
      if (stored !== undefined) {
        return stored;
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      errors.push(e);
      onError?.(e);
    }
  }
  if (errors.length > 0 && errors.length === drivers.length) {
    throw new StorageError('All drivers failed on get', errors);
  }
  return undefined;
}

export async function degradedSet(drivers: Driver[], key: string, value: unknown): Promise<void> {
  const errors: Error[] = [];
  for (let i = 0; i < drivers.length; i++) {
    const driver = drivers[i]!;
    try {
      await driver.set(key, value);
      for (let j = 0; j < drivers.length; j++) {
        if (j !== i) {
          await drivers[j]!.del(key).catch(() => {});
        }
      }
      return;
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }
  throw new StorageError('All drivers failed on set', errors);
}

export async function degradedDel(drivers: Driver[], key: string): Promise<void> {
  for (const driver of drivers) {
    await driver.del(key).catch(() => {});
  }
}
