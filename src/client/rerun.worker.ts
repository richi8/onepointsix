/// <reference lib="webworker" />
// Runs a replay's game again from its log, off the main thread, and sends
// back the ticks checked against the file (see exactrun.ts).

import { ExactRun, type ExactJob, type ExactNews } from './exactrun.ts';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (e: MessageEvent<ExactJob>) => {
  const run = new ExactRun(e.data);
  for (;;) {
    const news: ExactNews = run.next();
    if (news.k === 'batch') self.postMessage(news, [news.batch.data.buffer]);
    else {
      self.postMessage(news);
      break;
    }
  }
};
