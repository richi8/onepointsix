import { describe, expect, it } from 'vitest';
import type { KeyValue } from '../src/client/leaderboard.ts';
import { LOG_SIZE, RunLog } from '../src/client/runlog.ts';
import { DEFAULT_WORLD } from '../src/shared/worldconfig.ts';
import { runRecord, summarize, type RunEndEvent, type RunRecord } from '../src/shared/runstats.ts';
import { GRENADE } from '../src/shared/weapons.ts';

function memory(): KeyValue {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function end(over: Partial<RunEndEvent> = {}): RunEndEvent {
  return {
    k: 'runEnd', outcome: 'extracted', score: 1000, value: 800, items: [], kills: 0, guardKills: 1, contracts: [],
    time: 200.4, killer: '', extract: 1, death: null, ...over,
  };
}

const names = (i: number) => ['North beach', 'East landing zone'][i];

describe('run records', () => {
  it('records how a run got out', () => {
    const r = runRecord(end(), { seed: 7, weather: 'fog' }, 'offline', names, new Date('2026-09-25T10:00:00Z'));
    expect(r).toMatchObject({ at: '2026-09-25T10:00:00.000Z', seed: 7, conditions: 'fog', mode: 'offline', outcome: 'extracted', time: 200, extract: 'East landing zone', cause: '' });
  });

  it('records what killed a run', () => {
    const r = runRecord(end({ outcome: 'killed', score: 0, extract: -1, death: { by: 'guard', weapon: 0, head: true } }), DEFAULT_WORLD, 'online', names);
    expect(r).toMatchObject({ extract: '', cause: 'guard, Assault rifle, head' });
    expect(runRecord(end({ outcome: 'killed', death: { by: 'self', weapon: GRENADE, head: false } }), DEFAULT_WORLD, 'online', names).cause).toBe('self, Grenade');
    // An operator bot is named by its kind.
    expect(runRecord(end({ outcome: 'killed', death: { by: 'operator', weapon: 0, head: false, kind: 'camper' } }), DEFAULT_WORLD, 'online', names).cause)
      .toBe('camper, Assault rifle');
  });

  it('records how far off the killer was, who else had hit them and the damage taken', () => {
    const death = { by: 'guard', weapon: 0, head: false, distance: 64, shooters: { guards: 3, operators: 0 } } as const;
    const r = runRecord(end({ outcome: 'killed', death, taken: { guards: 180, operators: 20 } }), DEFAULT_WORLD, 'online', names);
    expect(r).toMatchObject({ killDistance: 64, guardShooters: 3, operatorShooters: 0, takenGuards: 180, takenOperators: 20 });
    const s = summarize([r, { ...r, killDistance: 20, guardShooters: 1 }, runRecord(end(), DEFAULT_WORLD, 'online', names)]);
    expect(s.medianKillDistance).toBe(42);
    expect(s.guardShooters).toEqual([['1 guard', 1], ['3 guards', 1]]);
  });

  it('counts contracts done', () => {
    const c = { kind: 'intel', outpost: 0, x: 0, y: 0, z: 0, reward: 1, progress: 0, panel: -1, name: '' } as const;
    const r = runRecord(end({ contracts: [{ ...c, state: 'done' }, { ...c, state: 'failed' }] }), DEFAULT_WORLD, 'online', names);
    expect(r).toMatchObject({ contracts: 2, contractsDone: 1 });
  });

  it('sums runs up', () => {
    const out = runRecord(end({ time: 300 }), DEFAULT_WORLD, 'online', names);
    const dead = runRecord(end({ outcome: 'killed', score: 0, time: 60, extract: -1, death: { by: 'guard', weapon: 0, head: false } }), DEFAULT_WORLD, 'online', names);
    const s = summarize([out, out, dead, { ...dead, time: 90 }]);
    expect(s).toMatchObject({ runs: 4, extracted: 0.5, killed: 0.5, mia: 0, meanTime: 187.5, medianTime: 195, meanExtractTime: 300, meanScore: 1000 });
    expect(s.causes).toEqual([['guard, Assault rifle', 2]]);
    expect(s.extracts).toEqual([['East landing zone', 2]]);
    expect(summarize([]).runs).toBe(0);
  });
});

describe('run log', () => {
  it('keeps the latest runs, newest first, and can be cleared', () => {
    const log = new RunLog(memory());
    const r = (score: number): RunRecord => runRecord(end({ score }), DEFAULT_WORLD, 'online', names);
    for (let i = 0; i < LOG_SIZE + 5; i++) log.add(r(i));
    expect(log.records()).toHaveLength(LOG_SIZE);
    expect(log.records()[0].score).toBe(LOG_SIZE + 4);
    log.clear();
    expect(log.records()).toEqual([]);
  });

  it('survives junk and no storage', () => {
    const store = memory();
    store.setItem('runlog', '{not json');
    expect(new RunLog(store).records()).toEqual([]);
    const none = new RunLog(null);
    none.add(runRecord(end(), DEFAULT_WORLD, 'online', names));
    expect(none.records()).toEqual([]);
  });
});
