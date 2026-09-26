import { EventEmitter } from 'node:events';
const emitter = new EventEmitter();
emitter.setMaxListeners(200);
export function publish(sessionId, event) {
    emitter.emit(`s:${sessionId}`, event);
}
export function subscribe(sessionId, fn) {
    emitter.on(`s:${sessionId}`, fn);
    return () => emitter.off(`s:${sessionId}`, fn);
}
//# sourceMappingURL=bus.js.map