import type { Driver } from '../types.js'

export function testDriver(name: string, createDriver: () => Driver | Promise<Driver>): void {
  describe(`Driver conformance: ${name}`, () => {
    let driver: Driver

    beforeEach(async () => {
      driver = await createDriver()
    })

    afterEach(async () => {
      await driver.dispose()
    })

    it('get returns undefined for missing key', async () => {
      expect(await driver.get('nonexistent')).toBeUndefined()
    })

    it('set and get round-trip', async () => {
      await driver.set('key1', { hello: 'world' })
      expect(await driver.get('key1')).toEqual({ hello: 'world' })
    })

    it('has returns false for missing, true for existing', async () => {
      expect(await driver.has('key1')).toBe(false)
      await driver.set('key1', 'value')
      expect(await driver.has('key1')).toBe(true)
    })

    it('del removes the key', async () => {
      await driver.set('key1', 'value')
      await driver.del('key1')
      expect(await driver.get('key1')).toBeUndefined()
      expect(await driver.has('key1')).toBe(false)
    })

    it('keys returns all keys', async () => {
      await driver.set('a', 1)
      await driver.set('b', 2)
      const keys = await driver.keys()
      expect(keys).toContain('a')
      expect(keys).toContain('b')
    })

    it('keys with prefix filters correctly', async () => {
      await driver.set('prefix:a', 1)
      await driver.set('prefix:b', 2)
      await driver.set('other:c', 3)
      const keys = await driver.keys('prefix:')
      expect(keys).toContain('prefix:a')
      expect(keys).toContain('prefix:b')
      expect(keys).not.toContain('other:c')
    })

    it('overwrite existing key', async () => {
      await driver.set('key1', 'old')
      await driver.set('key1', 'new')
      expect(await driver.get('key1')).toBe('new')
    })
  })
}
