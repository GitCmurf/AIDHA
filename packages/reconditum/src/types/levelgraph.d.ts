/**
 * Type declarations for levelgraph.
 *
 * LevelGraph doesn't ship with TypeScript types, so we declare them here.
 */
declare module 'levelgraph' {
  interface LevelGraphTriple {
    subject: string;
    predicate: string;
    object: string;
    [key: string]: unknown;
  }

  interface LevelGraphDB {
    put(
      triple: LevelGraphTriple | LevelGraphTriple[],
      callback: (err?: Error) => void
    ): void;
    get(
      pattern: Partial<LevelGraphTriple>,
      callback: (err: Error | null, list: LevelGraphTriple[]) => void
    ): void;
    del(triple: LevelGraphTriple, callback: (err?: Error) => void): void;
    close(callback: (err?: Error) => void): void;
  }

  interface LevelUpLike {
    // Minimal interface for level backends
  }

  function levelgraph(db: LevelUpLike): LevelGraphDB;

  export = levelgraph;
}
