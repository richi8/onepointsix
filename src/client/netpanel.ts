import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import type { LagTransport, NetConditions } from '../shared/transport.ts';
import { WEAPONS } from '../shared/weapons.ts';
import type { Connection } from './connection.ts';

const PRESETS: Record<string, NetConditions> = {
  off: { latency: 0, jitter: 0, loss: 0 },
  good: { latency: 25, jitter: 5, loss: 0 },
  '100ms': { latency: 50, jitter: 10, loss: 0.01 },
  bad: { latency: 100, jitter: 40, loss: 0.05 },
};

/**
 * Debug overlay (toggle with F3) showing net stats and fake-lag controls. The
 * fake lag belongs to the transport, so it carries over from run to run.
 */
export class NetPanel {
  /** The run being played, if any. */
  conn: Connection | null = null;
  private readonly root = document.createElement('div');
  private readonly stats = document.createElement('pre');
  private readonly net: NetConditions;

  constructor(transport: LagTransport<ClientMsg, ServerMsg>) {
    this.net = transport.net;
    this.root.className = 'netpanel';
    this.root.hidden = true;
    this.root.append(this.stats);

    const net = transport.net;
    for (const [key, label, max, scale] of [
      ['latency', 'Latency (one-way, ms)', 300, 1],
      ['jitter', 'Jitter (ms)', 100, 1],
      ['loss', 'Loss (%)', 50, 100],
    ] as const) {
      const row = document.createElement('label');
      const name = document.createElement('div');
      const input = document.createElement('input');
      const value = document.createElement('span');
      input.type = 'range';
      input.min = '0';
      input.max = String(max);
      input.value = String(net[key] * scale);
      input.dataset.key = key;
      input.dataset.scale = String(scale);
      name.textContent = label;
      value.textContent = input.value;
      input.oninput = () => {
        net[key] = Number(input.value) / scale;
        value.textContent = input.value;
      };
      row.append(name, input, value);
      this.root.append(row);
    }

    const presets = document.createElement('div');
    for (const [name, preset] of Object.entries(PRESETS)) {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = () => this.apply(preset);
      presets.append(b);
    }
    this.root.append(presets);
    document.body.append(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F3') return;
      e.preventDefault();
      this.root.hidden = !this.root.hidden;
    });
  }

  update(): void {
    const c = this.conn;
    if (this.root.hidden || !c) return;
    const pr = c.predictor;
    const me = pr.state;
    const pos = me ? `${me.x.toFixed(1)}, ${me.y.toFixed(1)}, ${me.z.toFixed(1)}` : '-';
    const speed = me ? Math.hypot(me.vx, me.vz).toFixed(1) : '-';
    const state = me
      ? (me.mantling ? 'mantle' : me.onGround ? 'ground' : 'air') +
        (me.slide > 0 ? ' slide' : me.crouched ? ' crouched' : '') +
        (me.lean !== 0 ? ` lean ${me.lean.toFixed(1)}` : '')
      : '-';
    const stamina = me ? `stamina ${(me.stamina * 100).toFixed(0)}%${me.winded ? ' winded' : ''}  carry ${me.carry} kg` : '';
    const weapon = me
      ? `hp ${me.hp}${me.dead ? ' dead' : ''}  ${WEAPONS[me.weapon].name} ${me.mag[me.weapon]}/${me.reserve[me.weapon]}` +
        (me.reload > 0 ? ' reloading' : me.draw > 0 ? ' drawing' : '') + `  aim ${me.aim.toFixed(2)}`
      : '';
    this.stats.textContent =
      `id ${c.id}  tick ${c.lastTick}  pos ${pos}\n` +
      `speed ${speed} m/s  ${state}\n` +
      `${stamina}\n` +
      `${weapon}\n` +
      `rtt ${c.rtt.toFixed(0)} ms  unacked cmds ${c.pendingCmds}\n` +
      `corrections ${pr.corrections}  last ${pr.lastError.toFixed(3)} m`;
  }

  private apply(preset: NetConditions): void {
    Object.assign(this.net, preset);
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[data-key]')) {
      const key = input.dataset.key as keyof NetConditions;
      input.value = String(preset[key] * Number(input.dataset.scale));
      input.dispatchEvent(new Event('input'));
    }
  }
}
