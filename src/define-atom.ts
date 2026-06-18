import type { Atom, AtomModifier } from './types.js';
import { atom } from './atom.js';

export function defineAtom(
  ...baseModifiers: AtomModifier<any>[]
): <T>(key: string, ...modifiers: AtomModifier<T>[]) => Atom<T> {
  return <T>(key: string, ...modifiers: AtomModifier<T>[]) => {
    return atom<T>(key, ...baseModifiers, ...modifiers);
  };
}
