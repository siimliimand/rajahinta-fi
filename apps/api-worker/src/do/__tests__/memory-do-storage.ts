/**
 * In-memory emulation of DurableObjectStorage for pure-DO unit tests.
 *
 * Mirrors the awaitable surface the DO classes use: get/put/delete/
 * deleteAll/list plus getAlarm/setAlarm/deleteAlarm. Values are held by
 * structured clone (like real DO storage), so callers cannot alias into
 * the stored state through the object they put.
 *
 * @module MemoryDoStorage
 */

/** A storage-shaped stub plus direct inspection hooks for assertions. */
export interface MemoryDoStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  /** Test hook: number of stored keys. */
  readonly size: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMemoryDoStorage(seed?: Record<string, unknown>): MemoryDoStorage {
  const map = new Map<string, unknown>(Object.entries(seed ?? {}));
  let alarm: number | null = null;

  return {
    async get<T>(key: string) {
      const value = map.get(key);
      return value === undefined ? undefined : (clone(value) as T);
    },
    async put<T>(key: string, value: T) {
      map.set(key, clone(value));
    },
    async delete(key: string) {
      return map.delete(key);
    },
    async deleteAll() {
      map.clear();
    },
    async list<T>(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      const result = new Map<string, T>();
      for (const [key, value] of map) {
        if (key.startsWith(prefix)) {
          result.set(key, clone(value) as T);
        }
      }
      return result;
    },
    async getAlarm() {
      return alarm;
    },
    async setAlarm(scheduledTime: number) {
      alarm = scheduledTime;
    },
    async deleteAlarm() {
      alarm = null;
    },
    get size() {
      return map.size;
    },
  };
}

/** Minimal DurableObjectState stand-in over a memory storage. */
export function createMemoryDoState(storage: MemoryDoStorage): DurableObjectState {
  return { storage } as unknown as DurableObjectState;
}

/** POST a JSON op to a DO instance's fetch handler. */
export async function callDo<T>(
  instance: { fetch(request: Request): Promise<Response> },
  body: unknown,
): Promise<T> {
  const response = await instance.fetch(
    new Request('https://do.internal/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
  return (await response.json()) as T;
}

/** POST a JSON op and return the raw response (status assertions). */
export async function callDoRaw(
  instance: { fetch(request: Request): Promise<Response> },
  body: unknown,
): Promise<Response> {
  return instance.fetch(
    new Request('https://do.internal/', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );
}

/**
 * Fire a DO's alarm the way workerd does: the pending alarm is cleared
 * *before* the handler runs (so getAlarm() inside it sees null), then
 * alarm() may schedule the next one.
 */
export async function fireAlarm(
  storage: MemoryDoStorage,
  instance: { alarm(): Promise<void> },
): Promise<void> {
  await storage.deleteAlarm();
  await instance.alarm();
}
