import type { Atom, AtomModifier } from './types';
import { atom } from './atom';

export function defineAtom(
  factory: (key: string) => AtomModifier<any>[],
): <T>(key: string, ...modifiers: AtomModifier<T>[]) => Atom<T> {
  return <T>(key: string, ...modifiers: AtomModifier<T>[]) => {
    const baseModifiers = factory(key);
    return atom<T>(key, ...(baseModifiers as AtomModifier<T>[]), ...modifiers);
  };
}
