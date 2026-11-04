// The one timer of the WhatsApp object, on the Durable Object's own alarm. The object has a single wake-up time ("the earliest thing
// that needs time to pass", which the core works out); this holds it and runs the handler when it comes.
//
// While the handler itself is running, asks to arm or cancel are folded into its answer (a cancel wins; arms keep the earliest time)
// so that the alarm the platform clears after a run does not wipe out an alarm set during it.
export interface OneTimer {
  /** Reads the alarm that is already set (call once, on start). */
  start(): Promise<void>;
  /** Sets the timer to wake at `at` (epoch ms), or cancels it when `at` is null. */
  arm(name: string, at: number | null): Promise<void>;
  /** Runs `run` for an alarm that fired. */
  fire(run: () => Promise<void>): Promise<void>;
  /** What is set now, by name: `{ at }` or undefined. */
  timers: { get(name: string): { at: number } | undefined };
}

export function oneTimer(storage: DurableObjectStorage, name: string): OneTimer {
  let at: number | null = null;
  let running = false;
  let asked: { cancelled: boolean; at: number | undefined } | undefined;

  const apply = async (next: number | null): Promise<void> => {
    at = next;
    if (next === null) await storage.deleteAlarm();
    else await storage.setAlarm(next);
  };

  return {
    async start() {
      at = (await storage.getAlarm()) ?? null;
    },
    async arm(n, when) {
      if (n !== name) throw new Error(`unknown timer ${n}`);
      if (running) {
        asked = when === null ? { cancelled: true, at: undefined } : { cancelled: false, at: Math.min(asked?.at ?? Infinity, when) };
        return;
      }
      await apply(when);
    },
    async fire(run) {
      running = true;
      asked = undefined;
      at = null;
      try {
        await run();
      } finally {
        const meanwhile = asked as { cancelled: boolean; at: number | undefined } | undefined;
        running = false;
        asked = undefined;
        if (meanwhile && !meanwhile.cancelled && meanwhile.at !== undefined) await apply(meanwhile.at);
      }
    },
    timers: { get: (n) => (n === name && at !== null ? { at } : undefined) },
  };
}
