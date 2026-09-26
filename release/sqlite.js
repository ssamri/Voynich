import { DatabaseSync } from 'node:sqlite';
function toValue(v) {
    if (v === undefined)
        return null;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    return v;
}
class Statement {
    stmt;
    named;
    constructor(stmt, sql) {
        this.stmt = stmt;
        const names = [...sql.matchAll(/[@:$]([A-Za-z_]\w*)/g)].map((m) => m[1]);
        this.named = names.length ? [...new Set(names)] : null;
    }
    /** Convertit les paramètres : undefined → NULL, booléens → 0/1, et ne garde que les paramètres nommés présents dans la requête. */
    bind(params) {
        const first = params[0];
        if (params.length === 1 && first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Uint8Array)) {
            const obj = first;
            const out = {};
            for (const k of this.named ?? [])
                out[k] = toValue(obj[k]);
            return [out];
        }
        return params.map(toValue);
    }
    run(...params) {
        const r = this.stmt.run(...this.bind(params));
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    }
    get(...params) {
        const row = this.stmt.get(...this.bind(params));
        return row ? { ...row } : undefined;
    }
    all(...params) {
        return this.stmt.all(...this.bind(params)).map((r) => ({ ...r }));
    }
}
export class Database {
    raw;
    cache = new Map();
    depth = 0;
    constructor(file) {
        this.raw = new DatabaseSync(file);
    }
    exec(sql) {
        this.raw.exec(sql);
    }
    prepare(sql) {
        let s = this.cache.get(sql);
        if (!s) {
            s = new Statement(this.raw.prepare(sql), sql);
            if (this.cache.size > 500)
                this.cache.clear();
            this.cache.set(sql, s);
        }
        return s;
    }
    /** `pragma('x = y')` exécute ; `pragma('x', { simple: true })` renvoie la première valeur. */
    pragma(source, opts = {}) {
        const rows = this.raw.prepare(`PRAGMA ${source}`).all().map((r) => ({ ...r }));
        if (opts.simple)
            return rows[0] ? Object.values(rows[0])[0] : undefined;
        return rows;
    }
    /** Transaction (imbriquable grâce aux points de sauvegarde), comme better-sqlite3. */
    transaction(fn) {
        return (...args) => {
            const sp = `sp_${this.depth}`;
            this.raw.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`);
            this.depth++;
            try {
                const out = fn(...args);
                this.depth--;
                this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
                return out;
            }
            catch (err) {
                this.depth--;
                this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
                throw err;
            }
        };
    }
}
//# sourceMappingURL=sqlite.js.map