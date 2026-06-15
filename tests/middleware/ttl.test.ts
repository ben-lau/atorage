import { atom } from '../../src/atom'
import { withDriver, withMiddleware } from '../../src/modifiers'
import { memoryDriver } from '../../src/drivers/memory'
import { ttl } from '../../src/middleware/ttl'

describe('ttl middleware', () => {
  const TTL_MS = 1000

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createAtom(key = 'ttl-key') {
    return atom<string>(key, withDriver(memoryDriver()), withMiddleware(ttl(TTL_MS)))
  }

  it('set writes value with expiration meta', async () => {
    const now = Date.now()
    vi.setSystemTime(now)

    const a = createAtom()
    await a.set('hello')

    const meta = await a.getMeta()
    expect(meta).toBeDefined()
    expect(typeof meta!.exp).toBe('number')
    expect(meta!.exp).toBe(now + TTL_MS)

    a.dispose()
  })

  it('get returns value before expiration', async () => {
    const a = createAtom()
    await a.set('hello')

    vi.advanceTimersByTime(TTL_MS - 1)
    await expect(a.get()).resolves.toBe('hello')

    a.dispose()
  })

  it('get returns undefined after expiration', async () => {
    const a = createAtom()
    await a.set('hello')

    vi.advanceTimersByTime(TTL_MS)
    await expect(a.get()).resolves.toBeUndefined()

    a.dispose()
  })

  it('has returns true before expiration', async () => {
    const a = createAtom()
    await a.set('hello')

    vi.advanceTimersByTime(TTL_MS - 1)
    await expect(a.has()).resolves.toBe(true)

    a.dispose()
  })

  it('has returns false after expiration', async () => {
    const a = createAtom()
    await a.set('hello')

    vi.advanceTimersByTime(TTL_MS)
    await expect(a.has()).resolves.toBe(false)

    a.dispose()
  })

  it('getMeta() shows exp field', async () => {
    const now = Date.now()
    vi.setSystemTime(now)

    const a = createAtom()
    await a.set('hello')

    await expect(a.getMeta()).resolves.toEqual({ exp: now + TTL_MS })

    a.dispose()
  })

  describe('deleteOnExpire', () => {
    function createAtomWithDelete(key = 'ttl-del-key') {
      const driver = memoryDriver()
      const a = atom<string>(
        key,
        withDriver(driver),
        withMiddleware(ttl(TTL_MS, { deleteOnExpire: true })),
      )
      return { a, driver }
    }

    it('expired get returns undefined and removes data from driver', async () => {
      const { a, driver } = createAtomWithDelete()
      await a.set('hello')
      expect(await driver.has('ttl-del-key')).toBe(true)

      vi.advanceTimersByTime(TTL_MS)
      await expect(a.get()).resolves.toBeUndefined()

      expect(await driver.has('ttl-del-key')).toBe(false)

      a.dispose()
    })

    it('non-expired get does not delete from driver', async () => {
      const { a, driver } = createAtomWithDelete()
      await a.set('hello')

      vi.advanceTimersByTime(TTL_MS - 1)
      await expect(a.get()).resolves.toBe('hello')
      expect(await driver.has('ttl-del-key')).toBe(true)

      a.dispose()
    })

    it('without deleteOnExpire, expired data stays in driver', async () => {
      const driver = memoryDriver()
      const a = atom<string>(
        'ttl-no-del',
        withDriver(driver),
        withMiddleware(ttl(TTL_MS)),
      )
      await a.set('hello')

      vi.advanceTimersByTime(TTL_MS)
      await expect(a.get()).resolves.toBeUndefined()
      expect(await driver.has('ttl-no-del')).toBe(true)

      a.dispose()
    })
  })
})
