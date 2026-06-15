import { atom } from '../../src/atom'
import { withDriver, withMiddleware } from '../../src/modifiers'
import { memoryDriver } from '../../src/drivers/memory'
import { lock } from '../../src/middleware/lock'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('lock middleware', () => {
  it('concurrent operations execute serially', async () => {
    const order: string[] = []
    const driver = memoryDriver()

    const a = atom<string>('lock-key', withDriver(driver), withMiddleware(lock()))

    const op1 = a.set('a').then(() => order.push('set-a-done'))
    await delay(5)
    order.push('between')

    const op2 = a.get().then(() => order.push('get-done'))

    await Promise.all([op1, op2])

    expect(order.indexOf('set-a-done')).toBeLessThan(order.indexOf('get-done'))
    expect(order.indexOf('between')).toBeLessThan(order.indexOf('get-done'))

    a.dispose()
  })

  it('operations complete in order', async () => {
    const order: number[] = []
    const driver = memoryDriver()

    const a = atom<number>('lock-order-key', withDriver(driver), withMiddleware(lock()))

    await Promise.all([
      a.set(1).then(() => order.push(1)),
      a.set(2).then(() => order.push(2)),
      a.set(3).then(() => order.push(3)),
    ])

    expect(order).toEqual([1, 2, 3])
    await expect(a.get()).resolves.toBe(3)

    a.dispose()
  })

  it('errors do not break the lock — next operation still works', async () => {
    const driver = memoryDriver()
    const a = atom<string>('lock-error-key', withDriver(driver), withMiddleware(lock()))

    await a.set('initial')

    const failing = a.update(async () => {
      throw new Error('boom')
    })

    await expect(failing).rejects.toThrow('boom')

    await a.set('recovered')
    await expect(a.get()).resolves.toBe('recovered')

    a.dispose()
  })
})
