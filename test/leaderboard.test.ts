import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, dropOldBoards, Leaderboard, type KeyValue } from '../src/client/leaderboard.ts';
import { mapFor } from '../src/shared/maps/index.ts';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const run = (score: number, name = 'me') => ({ name, score, date: '2026-09-25' });

describe('leaderboard', () => {
  it('keeps each island and mode apart, best first', () => {
    const board = new Leaderboard(memory());
    expect(board.add(1, 'extraction', run(300))).toBe(1);
    expect(board.add(1, 'extraction', run(900))).toBe(1);
    expect(board.add(1, 'extraction', run(500))).toBe(2);
    expect(board.add(1, 'range', run(100))).toBe(1);
    expect(board.add(2, 'extraction', run(50))).toBe(1);
    expect(board.entries(1, 'extraction').map((e) => e.score)).toEqual([900, 500, 300]);
    expect(board.best(1, 'range')?.score).toBe(100);
    expect(board.best(3, 'extraction')).toBeNull();
  });

  it('keeps only the best and skips empty runs', () => {
    const board = new Leaderboard(memory());
    for (let i = 1; i <= BOARD_SIZE; i++) board.add(1, 'extraction', run(i * 100));
    expect(board.add(1, 'extraction', run(50))).toBe(0);
    expect(board.add(1, 'extraction', run(0))).toBe(0);
    expect(board.add(1, 'extraction', run(1000, 'later'))).toBe(2);
    expect(board.entries(1, 'extraction')).toHaveLength(BOARD_SIZE);
    expect(board.entries(1, 'extraction')[1].name).toBe('later');
  });

  it('ranks Deathmatch games by kills, then fewest deaths, keeping the deaths', () => {
    const board = new Leaderboard(memory());
    expect(board.add(1, 'deathmatch', { ...run(5), deaths: 4 })).toBe(1);
    expect(board.add(1, 'deathmatch', { ...run(5), deaths: 2 })).toBe(1);
    expect(board.add(1, 'deathmatch', { ...run(5), deaths: 3 })).toBe(2);
    expect(board.entries(1, 'deathmatch').map((e) => e.deaths)).toEqual([2, 3, 4]);
    expect(board.entries(1, 'extraction')).toEqual([]);
  });

  it('keeps Deathmatch\'s board by its map, whatever the seed, and the islands\' games apart', () => {
    const store = memory();
    const board = new Leaderboard(store);
    store.data.set('board:1:deathmatch', JSON.stringify([{ ...run(9), deaths: 1 }]));
    store.data.set('board:1:deathmatch-towns', JSON.stringify([{ ...run(8), deaths: 1 }]));
    expect(board.entries(1, 'deathmatch')).toEqual([]);
    expect(board.add(1, 'deathmatch', { ...run(2), deaths: 5 })).toBe(1);
    expect(store.data.get('board:1:deathmatch')).toBe(JSON.stringify([{ ...run(9), deaths: 1 }]));
    expect(JSON.parse(store.data.get(`board:${mapFor('deathmatch')!.id}:deathmatch`)!)).toEqual([{ ...run(2), deaths: 5 }]);
    expect(board.entries(2, 'deathmatch')).toEqual([{ ...run(2), deaths: 5 }]);
  });

  it('drops the weather and time of day old scores were kept with', () => {
    const store = memory();
    const board = new Leaderboard(store);
    store.data.set('board:1:extraction', JSON.stringify([{ ...run(100), time: 'night', weather: 'fog' }, { ...run(50), weather: 'rain' }]));
    expect(board.entries(1, 'extraction')).toEqual([run(100), run(50)]);
  });

  it('survives broken or missing storage', () => {
    const store = memory();
    store.data.set('board:1:extraction', '{"not":"a list"');
    expect(new Leaderboard(store).entries(1, 'extraction')).toEqual([]);
    store.data.set('board:1:extraction', '[{"name":1},{"name":"ok","score":5,"date":"x"}]');
    expect(new Leaderboard(store).entries(1, 'extraction')).toEqual([{ name: 'ok', score: 5, date: 'x' }]);
    const none = new Leaderboard(null);
    expect(none.add(1, 'extraction', run(5))).toBe(1);
    expect(none.entries(1, 'extraction')).toEqual([]);
  });

  it('starts Extraction from the scores kept under Online, or else under Mixed', () => {
    const online = memory();
    online.data.set('board:1:online', '[{"name":"on","score":7,"date":"x"}]');
    online.data.set('board:1:mixed', '[{"name":"mix","score":5,"date":"x"}]');
    expect(new Leaderboard(online).best(1, 'extraction')?.name).toBe('on');

    const store = memory();
    store.data.set('board:1:mixed', '[{"name":"old","score":5,"date":"x"}]');
    const board = new Leaderboard(store);
    expect(board.best(1, 'extraction')?.name).toBe('old');
    expect(board.best(1, 'range')).toBeNull();
    board.add(1, 'extraction', run(9));
    expect(board.entries(1, 'extraction').map((e) => e.score)).toEqual([9, 5]);
  });
});

describe('old boards', () => {
  it("clears PvE's boards out of storage and folds Online's and Offline's into Extraction's", () => {
    const entry = (name: string, score: number) => ({ name, score, date: '2026-09-25' });
    const data = new Map([
      ['board:42:pve', '[]'], ['board:7:pve', '[]'],
      ['board:42:offline', JSON.stringify([entry('off', 300), entry('off', 100)])],
      ['board:42:mixed', JSON.stringify([entry('mix', 200)])],
      ['board:9:offline', JSON.stringify([entry('solo', 50)])],
      ['board:5:online', JSON.stringify([entry('on', 70), entry('on', 40)])],
      ['board:5:offline', JSON.stringify([entry('off', 60)])],
      ['name', 'Ana'],
    ]);
    const store = {
      get length() {
        return data.size;
      },
      key: (i: number) => [...data.keys()][i] ?? null,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
    expect(dropOldBoards(store)).toBe(6);
    expect([...data.keys()].sort()).toEqual(['board:42:extraction', 'board:42:mixed', 'board:5:extraction', 'board:9:extraction', 'name']);
    const board = new Leaderboard(store);
    expect(board.entries(42, 'extraction').map((e) => e.score)).toEqual([300, 200, 100]);
    expect(board.entries(9, 'extraction')).toEqual([entry('solo', 50)]);
    expect(board.entries(5, 'extraction').map((e) => e.score)).toEqual([70, 60, 40]);
    expect(dropOldBoards(null)).toBe(0);
  });
});
