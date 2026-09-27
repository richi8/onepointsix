import type { WorldConfig } from '../shared/worldconfig.ts';
import { localStore } from './leaderboard.ts';
import type { ReplayData } from './replayfile.ts';

// The last few runs' replays, kept in this browser (IndexedDB) so one played
// yesterday can still be watched from the menu. Where storage is blocked,
// nothing is kept and the list stays empty.

/** Replays kept; the oldest goes when another comes. */
export const KEEP = 5;
const DB = 'onepointsix';
const STORE = 'replays';

/** What the menu's list shows of a kept replay. */
export interface KeptReplay {
  key: number;
  name: string;
  world: WorldConfig;
  date: string;
  outcome: ReplayData['end']['outcome'];
  score: number;
  killer: string;
  /** Seconds the run lasted. */
  time: number;
}

interface Stored extends KeptReplay {
  bytes: Uint8Array<ArrayBuffer>;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
  // A failed open can be tried again.
  opening.catch(() => (opening = null));
  return opening;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Every replay kept, newest first. */
export async function keptReplays(): Promise<KeptReplay[]> {
  try {
    const db = await open();
    const all = await done(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<Stored[]>);
    return all.map(({ bytes: _, ...meta }) => meta).sort((a, b) => b.key - a.key);
  } catch {
    return [];
  }
}

/** Keep a replay, dropping the oldest past KEEP; false if it couldn't be kept. */
export async function keepReplay(r: ReplayData, bytes: Uint8Array<ArrayBuffer>): Promise<boolean> {
  try {
    const db = await open();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const e = r.end;
    const entry: Omit<Stored, 'key'> = {
      name: r.name, world: r.world, date: r.date, outcome: e.outcome, score: e.score, killer: e.killer, time: e.time, bytes,
    };
    store.add(entry);
    const keys = (await done(store.getAllKeys())) as number[];
    for (const key of keys.sort((a, b) => a - b).slice(0, Math.max(keys.length - KEEP, 0))) store.delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

/** A kept replay's file, or null if it's gone. */
export async function keptReplay(key: number): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const db = await open();
    const s = await done(db.transaction(STORE).objectStore(STORE).get(key) as IDBRequest<Stored | undefined>);
    return s?.bytes ?? null;
  } catch {
    return null;
  }
}

/**
 * This browser as a random id, saved in its replays: a replay from here says
 * "You" in the feed, and one from anywhere else the player's name.
 */
export function browserId(): string {
  const store = localStore();
  let id = store?.getItem('browserId') ?? '';
  if (!/^[0-9a-f]{16}$/.test(id)) {
    id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
    try {
      store?.setItem('browserId', id);
    } catch {
      // Not saved: a new one next time, that's all.
    }
  }
  return id;
}
