import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/**
 * Couche de compatibilité au-dessus de `node:sqlite` (SQLite intégré à Node ≥ 22.13),
 * qui reproduit la petite partie de l'API better-sqlite3 utilisée par l'application.
 * Aucun module natif à compiler : l'installation fonctionne sur les hébergements
 * mutualisés sans Python ni compilateur (Hostinger, etc.).
 */
type Params = unknown[];

function toValue(v: unknown): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
}

class Statement {
  private named: string[] | null;

  constructor(
    private stmt: StatementSync,
    sql: string,
  ) {
    const names = [...sql.matchAll(/[@:$]([A-Za-z_]\w*)/g)].map((m) => m[1]);
    this.named = names.length ? [...new Set(names)] : null;
  }

  /** Convertit les paramètres : undefined → NULL, booléens → 0/1, et ne garde que les paramètres nommés présents dans la requête. */
  private bind(params: Params): SQLInputValue[] | [Record<string, SQLInputValue>] {
    const first = params[0];
    if (params.length === 1 && first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Uint8Array)) {
      const obj = first as Record<string, unknown>;
      const out: Record<string, SQLInputValue> = {};
      for (const k of this.named ?? []) out[k] = toValue(obj[k]);
      return [out];
    }
    return params.map(toValue);
  }

  run(...params: Params) {
    const r = this.stmt.run(...(this.bind(params) as SQLInputValue[]));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get(...params: Params): unknown {
    const row = this.stmt.get(...(this.bind(params) as SQLInputValue[]));
    return row ? { ...row } : undefined;
  }

  all(...params: Params): unknown[] {
    return this.stmt.all(...(this.bind(params) as SQLInputValue[])).map((r) => ({ ...r }));
  }
}

export class Database {
  private raw: DatabaseSync;
  private cache = new Map<string, Statement>();
  private depth = 0;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
  }

  exec(sql: string) {
    this.raw.exec(sql);
  }

  prepare(sql: string) {
    let s = this.cache.get(sql);
    if (!s) {
      s = new Statement(this.raw.prepare(sql), sql);
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(sql, s);
    }
    return s;
  }

  /** `pragma('x = y')` exécute ; `pragma('x', { simple: true })` renvoie la première valeur. */
  pragma(source: string, opts: { simple?: boolean } = {}): unknown {
    const rows = this.raw.prepare(`PRAGMA ${source}`).all().map((r) => ({ ...r }));
    if (opts.simple) return rows[0] ? Object.values(rows[0])[0] : undefined;
    return rows;
  }

  /** Transaction (imbriquable grâce aux points de sauvegarde), comme better-sqlite3. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    return (...args: A): R => {
      const sp = `sp_${this.depth}`;
      this.raw.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
      this.depth++;
      try {
        const out = fn(...args);
        this.depth--;
        this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
        return out;
      } catch (err) {
        this.depth--;
        this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw err;
      }
    };
  }
}
