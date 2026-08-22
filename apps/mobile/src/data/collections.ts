/** Find the last matching value without relying on newer Array prototype methods. */
export const findLastMatching = <T>(
  values: ReadonlyArray<T>,
  predicate: (value: T) => boolean,
): T | undefined => {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && predicate(value)) {
      return value;
    }
  }
  return undefined;
};
