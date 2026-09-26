import { db } from '../db.js';
import { getSession, isRunning, startRun } from './runner.js';
export function getCampaign(sessionId) {
    return db.prepare('SELECT * FROM campaigns WHERE session_id = ?').get(sessionId);
}
export function upsertCampaign(sessionId, c) {
    const cur = getCampaign(sessionId);
    if (cur) {
        db.prepare('UPDATE campaigns SET enabled=?, hour=?, rounds=?, token_budget=?, report_agent_id=? WHERE id=?').run(c.enabled ? 1 : 0, c.hour, c.rounds, c.tokenBudget, c.reportAgentId ?? null, cur.id);
    }
    else {
        db.prepare('INSERT INTO campaigns(session_id, enabled, hour, rounds, token_budget, report_agent_id) VALUES (?,?,?,?,?,?)').run(sessionId, c.enabled ? 1 : 0, c.hour, c.rounds, c.tokenBudget, c.reportAgentId ?? null);
    }
    return getCampaign(sessionId);
}
function launch(c) {
    const session = getSession(c.session_id);
    if (!session || isRunning(c.session_id))
        return;
    const date = new Date().toLocaleDateString('fr-FR');
    db.prepare(`UPDATE campaigns SET last_run_at = ?, last_status = 'running' WHERE id = ?`).run(new Date().toISOString(), c.id);
    startRun(c.session_id, {
        rounds: c.rounds,
        tokenBudget: c.token_budget,
        report: { agentId: c.report_agent_id, title: `Rapport de campagne — ${session.title} — ${date}` },
        onFinish: (status) => db.prepare('UPDATE campaigns SET last_status = ? WHERE id = ?').run(status, c.id),
    });
}
export function runCampaignNow(sessionId) {
    const c = getCampaign(sessionId);
    if (!c)
        throw new Error('Aucune campagne configurée pour cette séance');
    if (isRunning(sessionId))
        throw new Error('La séance est déjà en cours');
    launch(c);
}
export function startCampaignScheduler() {
    const tick = () => {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const due = db.prepare('SELECT * FROM campaigns WHERE enabled = 1 AND hour = ?').all(now.getHours());
        for (const c of due) {
            if (c.last_run_at?.slice(0, 10) === today)
                continue;
            try {
                launch(c);
            }
            catch (err) {
                console.error('[campagne]', err.message);
            }
        }
    };
    setInterval(tick, 60_000).unref();
}
//# sourceMappingURL=campaigns.js.map