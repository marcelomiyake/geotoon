/**
 * Runs `step` on each item in order, starting each step only after the previous one has
 * settled. Used where order matters: statements on one database connection, migrations.
 */
export function inSequence<T>(items: readonly T[], step: (item: T) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>((previous, item) => previous.then(() => step(item)), Promise.resolve());
}
