import { createScope } from '../src/scope'

describe('createScope', () => {
  it('returns a Scope with the correct name', () => {
    const scope = createScope('auth')
    expect(scope.name).toBe('auth')
  })

  it("clear() dispatches a 'clear' event", () => {
    const scope = createScope('session')
    const listener = vi.fn()

    scope.addEventListener('clear', listener)
    scope.clear()

    expect(listener).toHaveBeenCalledOnce()
    expect(listener.mock.calls[0][0].type).toBe('clear')
  })

  it("addEventListener for 'clear' works", () => {
    const scope = createScope('app')
    const listener = vi.fn()

    scope.addEventListener('clear', listener)
    scope.clear()

    expect(listener).toHaveBeenCalledOnce()
  })

  it('multiple listeners all receive the clear event', () => {
    const scope = createScope('multi')
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()

    scope.addEventListener('clear', first)
    scope.addEventListener('clear', second)
    scope.addEventListener('clear', third)
    scope.clear()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(third).toHaveBeenCalledOnce()
  })

  it('removeEventListener stops the listener from being called', () => {
    const scope = createScope('removable')
    const listener = vi.fn()

    scope.addEventListener('clear', listener)
    scope.removeEventListener('clear', listener)
    scope.clear()

    expect(listener).not.toHaveBeenCalled()
  })

  it('two scopes are independent', () => {
    const auth = createScope('auth')
    const session = createScope('session')
    const authListener = vi.fn()
    const sessionListener = vi.fn()

    auth.addEventListener('clear', authListener)
    session.addEventListener('clear', sessionListener)

    auth.clear()

    expect(authListener).toHaveBeenCalledOnce()
    expect(sessionListener).not.toHaveBeenCalled()
  })
})
