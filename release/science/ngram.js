/**
 * Modèle de langue par n-grammes de caractères (interpolation de Witten-Bell).
 * Sert à mesurer si un texte « déchiffré » ressemble statistiquement à une langue donnée.
 * L'espace « _ » marque les frontières de mots.
 */
export class CharNgramModel {
    order;
    counts = [];
    contextTotals = [];
    contextTypes = [];
    alphabet = new Set();
    constructor(order = 4) {
        this.order = order;
        for (let i = 0; i <= order; i++) {
            this.counts.push(new Map());
            this.contextTotals.push(new Map());
            this.contextTypes.push(new Map());
        }
    }
    static fromText(text, order = 4) {
        const m = new CharNgramModel(order);
        m.train(text);
        return m;
    }
    train(text) {
        const s = `_${text.replace(/\s+/g, '_')}_`;
        for (const ch of s)
            this.alphabet.add(ch);
        const chars = [...s];
        for (let i = 0; i < chars.length; i++) {
            for (let n = 1; n <= this.order; n++) {
                if (i - n + 1 < 0)
                    break;
                const ctx = chars.slice(i - n + 1, i).join('');
                const key = `${ctx}\u0000${chars[i]}`;
                const c = this.counts[n];
                const prev = c.get(key) ?? 0;
                c.set(key, prev + 1);
                this.contextTotals[n].set(ctx, (this.contextTotals[n].get(ctx) ?? 0) + 1);
                if (prev === 0)
                    this.contextTypes[n].set(ctx, (this.contextTypes[n].get(ctx) ?? 0) + 1);
            }
        }
    }
    prob(ctx, ch) {
        // Base : unigramme lissé (add-one) sur l'alphabet + 1 symbole inconnu.
        const V = this.alphabet.size + 1;
        const total1 = this.contextTotals[1].get('') ?? 0;
        let p = ((this.counts[1].get(`\u0000${ch}`) ?? 0) + 1) / (total1 + V);
        for (let n = 2; n <= this.order; n++) {
            if (ctx.length < n - 1)
                break;
            const h = ctx.slice(ctx.length - (n - 1)).join('');
            const total = this.contextTotals[n].get(h);
            if (!total)
                break;
            const types = this.contextTypes[n].get(h) ?? 0;
            const c = this.counts[n].get(`${h}\u0000${ch}`) ?? 0;
            p = (c + types * p) / (total + types);
        }
        return p;
    }
    /** Entropie croisée en bits par caractère (plus bas = plus proche de la langue du modèle). */
    crossEntropy(text) {
        const chars = [...`_${text.trim().replace(/\s+/g, '_')}_`];
        if (chars.length < 3)
            return Infinity;
        let bits = 0;
        for (let i = 1; i < chars.length; i++) {
            bits -= Math.log2(this.prob(chars.slice(Math.max(0, i - this.order + 1), i), chars[i]));
        }
        return bits / (chars.length - 1);
    }
}
//# sourceMappingURL=ngram.js.map