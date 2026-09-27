declare const __BUILD__: string;

/** The build of the game, as a hash of the simulation's code (see vite.config.ts), saved in replays to tell one from another version. */
export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
