// @vitest-environment happy-dom
import { sessionStorageDriver } from '../../src/drivers/session-storage'

describe('sessionStorageDriver', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('available() returns true', () => {
    const driver = sessionStorageDriver()
    expect(driver.available!()).toBe(true)
  })

  it('set then get returns the value', async () => {
    const driver = sessionStorageDriver()
    await driver.set('foo', 'bar')
    expect(await driver.get('foo')).toBe('bar')
    await driver.set('num', 42)
    expect(await driver.get('num')).toBe(42)
  })

  it('get non-existent key returns undefined', async () => {
    const driver = sessionStorageDriver()
    expect(await driver.get('missing')).toBeUndefined()
  })

  it('has returns true/false', async () => {
    const driver = sessionStorageDriver()
    expect(await driver.has('foo')).toBe(false)
    await driver.set('foo', 1)
    expect(await driver.has('foo')).toBe(true)
  })

  it('del removes the value', async () => {
    const driver = sessionStorageDriver()
    await driver.set('foo', 'bar')
    await driver.del('foo')
    expect(await driver.get('foo')).toBeUndefined()
    expect(await driver.has('foo')).toBe(false)
  })

  it('keys returns all keys', async () => {
    const driver = sessionStorageDriver()
    await driver.set('a', 1)
    await driver.set('b', 2)
    await driver.set('c', 3)
    expect(await driver.keys()).toEqual(expect.arrayContaining(['a', 'b', 'c']))
    expect((await driver.keys()).length).toBe(3)
  })

  it('keys with prefix filters correctly', async () => {
    const driver = sessionStorageDriver()
    await driver.set('user:1', 'alice')
    await driver.set('user:2', 'bob')
    await driver.set('post:1', 'hello')
    expect(await driver.keys('user:')).toEqual(expect.arrayContaining(['user:1', 'user:2']))
    expect((await driver.keys('user:')).length).toBe(2)
  })

  it('complex objects round-trip correctly', async () => {
    const driver = sessionStorageDriver()
    const value = {
      nested: { arr: [1, 2, 3], flag: true },
      list: ['a', 'b', { c: 4 }],
    }
    await driver.set('complex', value)
    expect(await driver.get('complex')).toEqual(value)
  })

})
