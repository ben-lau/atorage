export class AsyncMutex {
  private _queue: Promise<void> = Promise.resolve()

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(() => fn())
    this._queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
