import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, Leaderboard, type KeyValue } from '../src/client/leaderboard.ts';

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const run = (score: number, name = 'me') => ({ name, score, date: '2026-09-25' });

describe('leaderboard', () => {
  it('keeps each island and mode apart, best first', () => {
    const board = new Leaderboard(memory());
    expect(board.add(1, 'pve', run(300))).toBe(1);
    expect(board.add(1, 'pve', run(900))).toBe(1);
    expect(board.add(1, 'pve', run(500))).toBe(2);
    expect(board.add(1, 'mixed', run(100))).toBe(1);
    expect(board.add(2, 'pve', run(50))).toBe(1);
    expect(board.entries(1, 'pve').map((e) => e.score)).toEqual([900, 500, 300]);
    expect(board.best(1, 'mixed')?.score).toBe(100);
    expect(board.best(3, 'pve')).toBeNull();
  });

  it('keeps only the best and skips empty runs', () => {
    const board = new Leaderboard(memory());
    for (let i = 1; i <= BOARD_SIZE; i++) board.add(1, 'pve', run(i * 100));
    expect(board.add(1, 'pve', run(50))).toBe(0);
    expect(board.add(1, 'pve', run(0))).toBe(0);
    expect(board.add(1, 'pve', run(1000, 'later'))).toBe(2);
    expect(board.entries(1, 'pve')).toHaveLength(BOARD_SIZE);
    expect(board.entries(1, 'pve')[1].name).toBe('later');
  });

  it('survives broken or missing storage', () => {
    const store = memory();
    store.data.set('board:1:pve', '{"not":"a list"');
    expect(new Leaderboard(store).entries(1, 'pve')).toEqual([]);
    store.data.set('board:1:pve', '[{"name":1},{"name":"ok","score":5,"date":"x"}]');
    expect(new Leaderboard(store).entries(1, 'pve')).toEqual([{ name: 'ok', score: 5, date: 'x' }]);
    const none = new Leaderboard(null);
    expect(none.add(1, 'pve', run(5))).toBe(1);
    expect(none.entries(1, 'pve')).toEqual([]);
  });
});
