import { atom } from '../../src/atom'
import { withDriver, withMiddleware } from '../../src/modifiers'
import { memoryDriver } from '../../src/drivers/memory'
import { compress } from '../../src/middleware/compress'

const simpleCompressor = {
  compress: (data: string) => btoa(data),
  decompress: (data: string) => atob(data),
}

describe('compress middleware', () => {
  it('set compresses the value, get decompresses it (round-trip)', async () => {
    const driver = memoryDriver()
    const a = atom<string>(
      'compress-key',
      withDriver(driver),
      withMiddleware(compress(simpleCompressor)),
    )

    await a.set('hello')
    const stored = await driver.get(a.key) as { $v: string }
    expect(stored.$v).toBe(btoa(JSON.stringify('hello')))
    expect(stored.$v).not.toBe('hello')

    await expect(a.get()).resolves.toBe('hello')

    a.dispose()
  })

  it('complex objects round-trip correctly', async () => {
    const a = atom<{ name: string; items: number[]; nested: { ok: boolean } }>(
      'compress-complex',
      withDriver(memoryDriver()),
      withMiddleware(compress(simpleCompressor)),
    )

    const value = { name: 'test', items: [1, 2, 3], nested: { ok: true } }
    await a.set(value)
    await expect(a.get()).resolves.toEqual(value)

    a.dispose()
  })

  it('get returns undefined for non-existent keys (no decompression attempted)', async () => {
    const decompress = vi.fn(simpleCompressor.decompress)
    const a = atom<string>(
      'compress-missing',
      withDriver(memoryDriver()),
      withMiddleware(compress({ ...simpleCompressor, decompress })),
    )

    await expect(a.get()).resolves.toBeUndefined()
    expect(decompress).not.toHaveBeenCalled()

    a.dispose()
  })

  it('del passes through', async () => {
    const a = atom<string>(
      'compress-del',
      withDriver(memoryDriver()),
      withMiddleware(compress(simpleCompressor)),
    )

    await a.set('to-delete')
    await expect(a.has()).resolves.toBe(true)
    await a.del()
    await expect(a.has()).resolves.toBe(false)
    await expect(a.get()).resolves.toBeUndefined()

    a.dispose()
  })

  it('async compress/decompress functions work', async () => {
    const asyncCompressor = {
      compress: async (data: string) => btoa(data),
      decompress: async (data: string) => atob(data),
    }

    const a = atom<number>(
      'compress-async',
      withDriver(memoryDriver()),
      withMiddleware(compress(asyncCompressor)),
    )

    await a.set(42)
    await expect(a.get()).resolves.toBe(42)

    a.dispose()
  })

  it('does not decompress pre-existing string data without cmp marker', async () => {
    const driver = memoryDriver()
    await driver.set('key', { $v: 'just a normal string' })

    const a = atom(
      'key',
      withDriver(driver),
      withMiddleware(compress(simpleCompressor)),
    )

    const val = await a.get()
    expect(val).toBe('just a normal string')

    a.dispose()
  })

  it('stores cmp marker in meta', async () => {
    const driver = memoryDriver()
    const a = atom(
      'key',
      withDriver(driver),
      withMiddleware(compress(simpleCompressor)),
    )

    await a.set({ hello: 'world' })
    const meta = await a.getMeta()
    expect(meta?.cmp).toBe(1)

    a.dispose()
  })

  it('corrupt data: decompress returns invalid JSON → value is undefined, error event fires', async () => {
    const driver = memoryDriver()
    const badCompressor = {
      compress: simpleCompressor.compress,
      decompress: () => '<<<not json>>>',
    }
    const a = atom(
      'corrupt-key',
      withDriver(driver),
      withMiddleware(compress(badCompressor)),
    )

    await driver.set('corrupt-key', { $v: 'garbage', $m: { cmp: 1 } })

    const errors: Error[] = []
    a.addEventListener('error', ((e: CustomEvent) => errors.push(e.detail.error)) as EventListener)

    const val = await a.get()
    expect(val).toBeUndefined()
    expect(errors.length).toBe(1)

    a.dispose()
  })

  it('corrupt data: decompress throws → value is undefined, error event fires', async () => {
    const driver = memoryDriver()
    const throwingCompressor = {
      compress: simpleCompressor.compress,
      decompress: () => { throw new Error('decompress boom') },
    }
    const a = atom(
      'corrupt-throw',
      withDriver(driver),
      withMiddleware(compress(throwingCompressor)),
    )

    await driver.set('corrupt-throw', { $v: 'bad', $m: { cmp: 1 } })

    const errors: Error[] = []
    a.addEventListener('error', ((e: CustomEvent) => errors.push(e.detail.error)) as EventListener)

    const val = await a.get()
    expect(val).toBeUndefined()
    expect(errors.length).toBe(1)
    expect(errors[0].message).toBe('decompress boom')

    a.dispose()
  })
})
