import { executePipeline } from '../../src/core/pipeline'
import type {
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareWithHooks,
} from '../../src/types'

function createCtx(overrides?: Partial<MiddlewareContext>): MiddlewareContext {
  return {
    key: 'test',
    operation: 'get',
    meta: {},
    requestWriteback: () => {},
    ...overrides,
  }
}

describe('executePipeline', () => {
  it('calls coreHandler directly when middleware array is empty', async () => {
    const order: string[] = []
    const coreHandler = async () => {
      order.push('core')
    }

    await executePipeline([], createCtx(), coreHandler)

    expect(order).toEqual(['core'])
  })

  it('wraps coreHandler with a single middleware', async () => {
    const order: string[] = []
    const mw: MiddlewareFunction = async (_ctx, next) => {
      order.push('mw-before')
      await next()
      order.push('mw-after')
    }
    const coreHandler = async () => {
      order.push('core')
    }

    await executePipeline([mw], createCtx(), coreHandler)

    expect(order).toEqual(['mw-before', 'core', 'mw-after'])
  })

  it('executes multiple middleware in onion order', async () => {
    const order: string[] = []
    const mw1: MiddlewareFunction = async (_ctx, next) => {
      order.push('mw1-before')
      await next()
      order.push('mw1-after')
    }
    const mw2: MiddlewareFunction = async (_ctx, next) => {
      order.push('mw2-before')
      await next()
      order.push('mw2-after')
    }
    const mw3: MiddlewareFunction = async (_ctx, next) => {
      order.push('mw3-before')
      await next()
      order.push('mw3-after')
    }
    const coreHandler = async () => {
      order.push('core')
    }

    await executePipeline([mw1, mw2, mw3], createCtx(), coreHandler)

    expect(order).toEqual([
      'mw1-before',
      'mw2-before',
      'mw3-before',
      'core',
      'mw3-after',
      'mw2-after',
      'mw1-after',
    ])
  })

  it('passes ctx.value modifications before next() to downstream', async () => {
    const ctx = createCtx({ value: 'original' })
    const mw1: MiddlewareFunction = async (ctx, next) => {
      ctx.value = 'from-mw1'
      await next()
    }
    const mw2: MiddlewareFunction = async (ctx, next) => {
      expect(ctx.value).toBe('from-mw1')
      ctx.value = 'from-mw2'
      await next()
    }
    const coreHandler = async () => {
      expect(ctx.value).toBe('from-mw2')
    }

    await executePipeline([mw1, mw2], ctx, coreHandler)
  })

  it('passes ctx.value modifications after next() to upstream', async () => {
    const ctx = createCtx({ value: 'original' })
    const mw1: MiddlewareFunction = async (ctx, next) => {
      await next()
      expect(ctx.value).toBe('from-mw2-after')
      ctx.value = 'from-mw1-after'
    }
    const mw2: MiddlewareFunction = async (ctx, next) => {
      await next()
      ctx.value = 'from-mw2-after'
    }
    const coreHandler = async () => {
      expect(ctx.value).toBe('original')
    }

    await executePipeline([mw1, mw2], ctx, coreHandler)

    expect(ctx.value).toBe('from-mw1-after')
  })

  it('supports MiddlewareWithHooks object form', async () => {
    const order: string[] = []
    const mw: MiddlewareWithHooks = {
      handle: async (_ctx, next) => {
        order.push('hooks-before')
        await next()
        order.push('hooks-after')
      },
    }
    const coreHandler = async () => {
      order.push('core')
    }

    await executePipeline([mw], createCtx(), coreHandler)

    expect(order).toEqual(['hooks-before', 'core', 'hooks-after'])
  })

  it('allows middleware to short-circuit by not calling next()', async () => {
    const order: string[] = []
    const mw1: MiddlewareFunction = async (_ctx, next) => {
      order.push('mw1-before')
      await next()
      order.push('mw1-after')
    }
    const mw2: MiddlewareFunction = async (_ctx, _next) => {
      order.push('mw2-short-circuit')
    }
    const coreHandler = async () => {
      order.push('core')
    }

    await executePipeline([mw1, mw2], createCtx(), coreHandler)

    expect(order).toEqual(['mw1-before', 'mw2-short-circuit', 'mw1-after'])
    expect(order).not.toContain('core')
  })

  it('runs async middleware in correct order', async () => {
    const order: string[] = []
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const mw1: MiddlewareFunction = async (_ctx, next) => {
      order.push('mw1-before-start')
      await delay(30)
      order.push('mw1-before-end')
      await next()
      order.push('mw1-after-start')
      await delay(30)
      order.push('mw1-after-end')
    }
    const mw2: MiddlewareFunction = async (_ctx, next) => {
      order.push('mw2-before-start')
      await delay(10)
      order.push('mw2-before-end')
      await next()
      order.push('mw2-after-start')
      await delay(10)
      order.push('mw2-after-end')
    }
    const coreHandler = async () => {
      order.push('core')
    }

    await executePipeline([mw1, mw2], createCtx(), coreHandler)

    expect(order).toEqual([
      'mw1-before-start',
      'mw1-before-end',
      'mw2-before-start',
      'mw2-before-end',
      'core',
      'mw2-after-start',
      'mw2-after-end',
      'mw1-after-start',
      'mw1-after-end',
    ])
  })

  it('propagates errors from middleware', async () => {
    const error = new Error('middleware failure')
    const mw: MiddlewareFunction = async () => {
      throw error
    }
    const coreHandler = async () => {}

    await expect(
      executePipeline([mw], createCtx(), coreHandler),
    ).rejects.toBe(error)
  })

  it('propagates errors from coreHandler', async () => {
    const error = new Error('core failure')
    const mw: MiddlewareFunction = async (_ctx, next) => {
      await next()
    }
    const coreHandler = async () => {
      throw error
    }

    await expect(
      executePipeline([mw], createCtx(), coreHandler),
    ).rejects.toBe(error)
  })
})
