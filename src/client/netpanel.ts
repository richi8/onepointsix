import type { NetConditions } from '../shared/transport.ts';
import type { Connection } from './connection.ts';

const PRESETS: Record<string, NetConditions> = {
  off: { latency: 0, jitter: 0, loss: 0 },
  good: { latency: 25, jitter: 5, loss: 0 },
  '100ms': { latency: 50, jitter: 10, loss: 0.01 },
  bad: { latency: 100, jitter: 40, loss: 0.05 },
};

/** Debug overlay (toggle with F3) showing net stats and fake-lag controls. */
export class NetPanel {
  private readonly root = document.createElement('div');
  private readonly stats = document.createElement('pre');
  private readonly conn: Connection;

  constructor(conn: Connection) {
    this.conn = conn;
    this.root.className = 'netpanel';
    this.root.append(this.stats);

    const net = conn.transport.net;
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
    if (this.root.hidden) return;
    const c = this.conn;
    const pr = c.predictor;
    const me = pr.state;
    const pos = me ? `${me.x.toFixed(1)}, ${me.y.toFixed(1)}, ${me.z.toFixed(1)}` : '-';
    const speed = me ? Math.hypot(me.vx, me.vz).toFixed(1) : '-';
    const state = me ? (me.onGround ? 'ground' : 'air') + (me.crouched ? ' crouched' : '') : '-';
    this.stats.textContent =
      `id ${c.id}  tick ${c.lastTick}  pos ${pos}\n` +
      `speed ${speed} m/s  ${state}\n` +
      `rtt ${c.rtt.toFixed(0)} ms  unacked cmds ${c.pendingCmds}\n` +
      `corrections ${pr.corrections}  last ${pr.lastError.toFixed(3)} m`;
  }

  private apply(preset: NetConditions): void {
    Object.assign(this.conn.transport.net, preset);
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      const key = input.dataset.key as keyof NetConditions;
      input.value = String(preset[key] * Number(input.dataset.scale));
      input.dispatchEvent(new Event('input'));
    }
  }
}
