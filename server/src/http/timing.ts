/**
 * Response-timing equalisation.
 *
 * /api/forgot-password must answer identically whether or not the address
 * exists, and "identically" includes how long it takes: sending an email is
 * tens of milliseconds slower than deciding not to, which is enough to
 * enumerate accounts over a few hundred requests.
 *
 * Every response from such an endpoint is held to the same floor, so the
 * observable duration carries no information about the branch taken.
 */

/** Minimum duration, ms, for responses that must not leak a branch. */
export const CONSTANT_TIME_FLOOR_MS = 400;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run `work`, then wait until `floorMs` has elapsed since the call started.
 *
 * A thrown error is held back for the same floor and then rethrown, so a
 * failure path is not faster than a success path either.
 */
export async function withConstantTime<T>(
  work: () => Promise<T>,
  floorMs: number = CONSTANT_TIME_FLOOR_MS,
): Promise<T> {
  const started = Date.now();
  const settle = async (): Promise<void> => {
    const remaining = floorMs - (Date.now() - started);
    if (remaining > 0) await sleep(remaining);
  };

  try {
    const result = await work();
    await settle();
    return result;
  } catch (error) {
    await settle();
    throw error;
  }
}
