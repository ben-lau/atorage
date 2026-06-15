import { atom } from '../../src/atom'
import { withDriver, withMiddleware } from '../../src/modifiers'
import { memoryDriver } from '../../src/drivers/memory'
import { cached } from '../../src/middleware/cached'
import { eventBus } from '../../src/core/event-bus'

function spyDriver() {
  const driver = memoryDriver()
  let getCount = 0
  return {
    ...driver,
    get: async (key: string) => {
      getCount++
      return driver.get(key)
    },
    getCount: () => getCount,
  }
}

describe('cached middleware', () => {
  afterEach(() => {
    eventBus._clear()
  })

  it('first get reads from driver, second get returns cached', async () => {
    const driver = spyDriver()
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cached()))

    await driver.set(a.key, { $v: 'stored' })

    await expect(a.get()).resolves.toBe('stored')
    expect(driver.getCount()).toBe(1)

    await expect(a.get()).resolves.toBe('stored')
    expect(driver.getCount()).toBe(1)

    a.dispose()
  })

  it('set updates the cache', async () => {
    const driver = spyDriver()
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cached()))

    await a.set('new-value')
    await expect(a.get()).resolves.toBe('new-value')
    expect(driver.getCount()).toBe(0)

    a.dispose()
  })

  it('del clears the cache', async () => {
    const driver = spyDriver()
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cached()))

    await a.set('value')
    await a.get()
    expect(driver.getCount()).toBe(0)

    await a.del()
    await expect(a.get()).resolves.toBeUndefined()
    expect(driver.getCount()).toBe(1)

    a.dispose()
  })

  it('onExternalChange invalidates cache (next get reads from driver)', async () => {
    const driver = spyDriver()
    const cacheMw = cached()
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cacheMw))

    await driver.set(a.key, { $v: 'stored' })

    await expect(a.get()).resolves.toBe('stored')
    expect(driver.getCount()).toBe(1)

    cacheMw.onExternalChange!()

    await expect(a.get()).resolves.toBe('stored')
    expect(driver.getCount()).toBe(2)

    a.dispose()
  })

  it('onDispose clears cache', async () => {
    const driver = spyDriver()
    const cacheMw = cached()
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cacheMw))

    await a.set('value')
    await a.get()
    expect(driver.getCount()).toBe(0)

    a.dispose()

    const a2 = atom<string>('cached-key', withDriver(driver), withMiddleware(cached()))
    await expect(a2.get()).resolves.toBe('value')
    expect(driver.getCount()).toBe(1)

    a2.dispose()
  })
})
