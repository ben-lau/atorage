import { wrap, unwrap } from '../../src/core/wrap';

describe('wrap', () => {
  it('includes $m when meta has keys', () => {
    expect(wrap('hello', { exp: 123, ver: 1 })).toEqual({
      $v: 'hello',
      $m: { exp: 123, ver: 1 },
    });
  });

  it('omits $m when meta is empty', () => {
    expect(wrap('hello', {})).toEqual({ $v: 'hello' });
    expect(wrap('hello', {})).not.toHaveProperty('$m');
  });

  it('wraps undefined value', () => {
    expect(wrap(undefined, {})).toEqual({ $v: undefined });
    expect(wrap(undefined, { exp: 1 })).toEqual({
      $v: undefined,
      $m: { exp: 1 },
    });
  });
});

describe('unwrap', () => {
  it('unwraps a normal wrapped value with meta', () => {
    expect(unwrap({ $v: 'hello', $m: { exp: 123, ver: 1 } })).toEqual({
      value: 'hello',
      meta: { exp: 123, ver: 1 },
    });
  });

  it('unwraps a wrapped value without meta', () => {
    expect(unwrap({ $v: 42 })).toEqual({
      value: 42,
      meta: {},
    });
  });

  it('returns undefined value and empty meta for null', () => {
    expect(unwrap(null)).toEqual({ value: undefined, meta: {} });
  });

  it('returns undefined value and empty meta for undefined', () => {
    expect(unwrap(undefined)).toEqual({ value: undefined, meta: {} });
  });

  it('treats raw non-object values as the value itself', () => {
    expect(unwrap('legacy')).toEqual({ value: 'legacy', meta: {} });
    expect(unwrap(99)).toEqual({ value: 99, meta: {} });
    expect(unwrap(true)).toEqual({ value: true, meta: {} });
  });

  it('treats raw objects without $v as the value itself', () => {
    const raw = { foo: 'bar', nested: { a: 1 } };
    expect(unwrap(raw)).toEqual({ value: raw, meta: {} });
  });
});
