/** Whether every item gives the same value (true for none or one). */
export const allSame = <T, V>(items: readonly T[], value: (item: T) => V): boolean =>
  items.every((item) => Object.is(value(item), value(items[0]!)));
