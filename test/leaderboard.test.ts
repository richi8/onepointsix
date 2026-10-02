import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, dropOldBoards, Leaderboard, type KeyValue } from '../src/client/leaderboard.ts';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const run = (score: number, name = 'me') => ({ name, score, date: '2026-09-25' });

describe('leaderboard', () => {
  it('keeps each island and mode apart, best first', () => {
    const board = new Leaderboard(memory());
    expect(board.add(1, 'offline', run(300))).toBe(1);
    expect(board.add(1, 'offline', run(900))).toBe(1);
    expect(board.add(1, 'offline', run(500))).toBe(2);
    expect(board.add(1, 'online', run(100))).toBe(1);
    expect(board.add(2, 'offline', run(50))).toBe(1);
    expect(board.entries(1, 'offline').map((e) => e.score)).toEqual([900, 500, 300]);
    expect(board.best(1, 'online')?.score).toBe(100);
    expect(board.best(3, 'offline')).toBeNull();
  });

  it('keeps only the best and skips empty runs', () => {
    const board = new Leaderboard(memory());
    for (let i = 1; i <= BOARD_SIZE; i++) board.add(1, 'offline', run(i * 100));
    expect(board.add(1, 'offline', run(50))).toBe(0);
    expect(board.add(1, 'offline', run(0))).toBe(0);
    expect(board.add(1, 'offline', run(1000, 'later'))).toBe(2);
    expect(board.entries(1, 'offline')).toHaveLength(BOARD_SIZE);
    expect(board.entries(1, 'offline')[1].name).toBe('later');
  });

  it('drops the weather and time of day old scores were kept with', () => {
    const store = memory();
    const board = new Leaderboard(store);
    store.data.set('board:1:offline', JSON.stringify([{ ...run(100), time: 'night', weather: 'fog' }, { ...run(50), weather: 'rain' }]));
    expect(board.entries(1, 'offline')).toEqual([run(100), run(50)]);
  });

  it('survives broken or missing storage', () => {
    const store = memory();
    store.data.set('board:1:offline', '{"not":"a list"');
    expect(new Leaderboard(store).entries(1, 'offline')).toEqual([]);
    store.data.set('board:1:offline', '[{"name":1},{"name":"ok","score":5,"date":"x"}]');
    expect(new Leaderboard(store).entries(1, 'offline')).toEqual([{ name: 'ok', score: 5, date: 'x' }]);
    const none = new Leaderboard(null);
    expect(none.add(1, 'offline', run(5))).toBe(1);
    expect(none.entries(1, 'offline')).toEqual([]);
  });

  it('starts Online from the scores kept under Mixed', () => {
    const store = memory();
    store.data.set('board:1:mixed', '[{"name":"old","score":5,"date":"x"}]');
    const board = new Leaderboard(store);
    expect(board.best(1, 'online')?.name).toBe('old');
    expect(board.best(1, 'offline')).toBeNull();
    board.add(1, 'online', run(9));
    expect(board.entries(1, 'online').map((e) => e.score)).toEqual([9, 5]);
  });
});

describe('old boards', () => {
  it("clears PvE's boards out of storage and leaves the rest", () => {
    const data = new Map([
      ['board:42:pve', '[]'], ['board:7:pve', '[]'], ['board:42:offline', '[1]'], ['board:42:mixed', '[2]'], ['name', 'Ana'],
    ]);
    const store = {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      removeItem: (k: string) => void data.delete(k),
    };
    expect(dropOldBoards(store)).toBe(2);
    expect([...data.keys()]).toEqual(['board:42:offline', 'board:42:mixed', 'name']);
    expect(dropOldBoards(null)).toBe(0);
  });
});
