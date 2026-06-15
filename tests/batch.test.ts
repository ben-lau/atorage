import { atom } from '../src/atom'
import { batch } from '../src/batch'
import { withDriver } from '../src/modifiers'
import { memoryDriver } from '../src/drivers/memory'
import { eventBus } from '../src/core/event-bus'

describe('batch', () => {
  afterEach(() => {
    eventBus._clear()
  })

  it('aggregates multiple set() on same atom into one change event', async () => {
    const a = atom('foo', withDriver(memoryDriver()))
    const events: string[] = []
    a.addEventListener('change', () => events.push('change'))

    await batch(async () => {
      await a.set('a')
      await a.set('b')
      await a.set('c')
    })

    expect(events).toEqual(['change'])

    a.dispose()
  })

  it('aggregates set then del on same atom into one delete event', async () => {
    const a = atom('foo', withDriver(memoryDriver()))
    const events: string[] = []
    a.addEventListener('change', () => events.push('change'))
    a.addEventListener('delete', () => events.push('delete'))

    await batch(async () => {
      await a.set('x')
      await a.del()
    })

    expect(events).toEqual(['delete'])

    a.dispose()
  })

  it('fires events after batch completes, not during', async () => {
    const a = atom('foo', withDriver(memoryDriver()))
    const events: string[] = []
    a.addEventListener('change', () => events.push('change'))

    await batch(async () => {
      await a.set('x')
      expect(events).toEqual([])
    })

    expect(events).toEqual(['change'])

    a.dispose()
  })

  it('nested batch defers to outer batch', async () => {
    const a = atom('foo', withDriver(memoryDriver()))
    const events: string[] = []
    a.addEventListener('change', () => events.push('change'))

    await batch(async () => {
      await a.set('a')
      await batch(async () => {
        await a.set('b')
        expect(events).toEqual([])
      })
      expect(events).toEqual([])
    })

    expect(events).toEqual(['change'])

    a.dispose()
  })

  it('dispatches events even when batch fn throws', async () => {
    const a = atom('foo', withDriver(memoryDriver()))
    const events: string[] = []
    a.addEventListener('change', () => events.push('change'))

    await expect(
      batch(async () => {
        await a.set('updated')
        throw new Error('batch error')
      }),
    ).rejects.toThrow('batch error')

    expect(events).toEqual(['change'])

    a.dispose()
  })

  it('fires events immediately without batch', async () => {
    const a = atom('foo', withDriver(memoryDriver()))
    const events: string[] = []
    a.addEventListener('change', () => events.push('change'))
    a.addEventListener('delete', () => events.push('delete'))

    await a.set('a')
    expect(events).toEqual(['change'])

    await a.set('b')
    expect(events).toEqual(['change', 'change'])

    await a.del()
    expect(events).toEqual(['change', 'change', 'delete'])

    a.dispose()
  })
})
