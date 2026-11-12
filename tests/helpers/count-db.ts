// A database that counts the statements sent through it. The free plan allows one run 50
// database queries, so the tests count them the way the platform does: a batch of five is five.
class CountedStatement {
  constructor(
    readonly real: D1PreparedStatement,
    private readonly tick: (n: number) => void,
  ) {}

  bind(...values: unknown[]): CountedStatement {
    return new CountedStatement(this.real.bind(...values), this.tick);
  }

  first<T>(column?: string): Promise<T | null> {
    this.tick(1);
    return column === undefined ? this.real.first<T>() : this.real.first<T>(column);
  }

  run<T>(): Promise<D1Result<T>> {
    this.tick(1);
    return this.real.run<T>();
  }

  all<T>(): Promise<D1Result<T>> {
    this.tick(1);
    return this.real.all<T>();
  }
}

export type CountedDb = { db: D1Database; queries(): number; reset(): void };

export function counted(real: D1Database): CountedDb {
  let n = 0;
  const tick = (by: number) => {
    n += by;
  };
  const db = {
    prepare: (sql: string) => new CountedStatement(real.prepare(sql), tick),
    batch: (statements: CountedStatement[]) => {
      tick(statements.length);
      return real.batch(statements.map((s) => s.real));
    },
    exec: (sql: string) => {
      tick(1);
      return real.exec(sql);
    },
  };
  return {
    db: db as unknown as D1Database,
    queries: () => n,
    reset: () => {
      n = 0;
    },
  };
}
