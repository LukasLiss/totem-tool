/** Small combinatorics helpers shared by the playout engines. */

/**
 * Own-property record lookup. Activity and object-type names come from
 * user models, so a name like "constructor" must not fall through to
 * Object.prototype.
 */
export function lookup<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** k-combinations of arr, in lexicographic index order. */
export function combinations<T>(arr: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const result: T[][] = [];
  const pick: T[] = [];
  const go = (start: number) => {
    if (pick.length === k) {
      result.push([...pick]);
      return;
    }
    for (let i = start; i <= arr.length - (k - pick.length); i++) {
      pick.push(arr[i]);
      go(i + 1);
      pick.pop();
    }
  };
  go(0);
  return result;
}

/** All non-empty subsets of arr (2^n - 1 of them; n stays small). */
export function nonEmptySubsets<T>(arr: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let k = 1; k <= arr.length; k++) result.push(...combinations(arr, k));
  return result;
}
