export class AtomDisposedError extends Error {
  override name = 'AtomDisposedError';

  constructor(key: string) {
    super(`Atom "${key}" has been disposed`);
  }
}

export class StorageError extends Error {
  override name = 'StorageError';

  constructor(
    message: string,
    public readonly errors?: Error[],
  ) {
    super(message);
  }
}
