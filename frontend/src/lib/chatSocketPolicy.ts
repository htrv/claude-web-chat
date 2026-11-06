/** Server events that mean an assistant reply is still in flight (incl. after page reload + catchup). */
export function assistantTurnFromServerEvent(type: string): "start" | "end" | null {
  if (type === "thinking" || type === "catchup" || type === "chunk" || type === "thinking_chunk") return "start";
  if (type === "done" || type === "error" || type === "limit_hit" || type === "stopped") return "end";
  return null;
}

/** Pure rules for WebSocket close / reconnect (easier to test than the full provider). */
export function socketClosePolicy(opts: { assistantTurnPending: boolean; isActiveChat: boolean }) {
  const { assistantTurnPending, isActiveChat } = opts;

  const shouldClearStreamVisual = !assistantTurnPending;

  const shouldScheduleReconnect = assistantTurnPending || isActiveChat;

  const shouldWarnDisconnected = isActiveChat && shouldScheduleReconnect;

  return {
    shouldClearStreamVisual,
    shouldScheduleReconnect,
    shouldWarnDisconnected,
  };
}
