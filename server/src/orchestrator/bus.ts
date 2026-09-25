import { EventEmitter } from 'node:events';

export type SessionEvent =
  | { type: 'status'; status: string; detail?: string }
  | { type: 'message'; message: unknown }
  | { type: 'turn_start'; tempId: string; agentId: number; agentName: string; color: string }
  | { type: 'delta'; tempId: string; text: string }
  | { type: 'thinking'; tempId: string; text: string }
  | { type: 'tool_call'; tempId: string; callId: string; name: string; input: unknown }
  | { type: 'tool_result'; tempId: string; callId: string; name: string; output: string; isError: boolean }
  | { type: 'turn_end'; tempId: string; message: unknown }
  | { type: 'memory'; memory: unknown }
  | { type: 'error'; error: string };

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function publish(sessionId: number, event: SessionEvent) {
  emitter.emit(`s:${sessionId}`, event);
}

export function subscribe(sessionId: number, fn: (e: SessionEvent) => void) {
  emitter.on(`s:${sessionId}`, fn);
  return () => emitter.off(`s:${sessionId}`, fn);
}
