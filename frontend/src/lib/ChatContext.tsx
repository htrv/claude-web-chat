import React, { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { notifications } from "@mantine/notifications";
import { api } from "./api";
import { assistantTurnFromServerEvent, socketClosePolicy } from "./chatSocketPolicy";
import type { ChatOut, MessageOut, UserOut, WorkspaceItem } from "./api";

function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export type StreamMsg = MessageOut & { _streaming?: boolean };

const PAGE_SIZE = 30;

export interface LimitHitInfo {
  chatId: string;
  resumeAt: string;
  claudeSessionId: string | null;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
  durationMs: number;
}

interface ChatContextValue {
  user: UserOut | null;
  chats: ChatOut[];
  activeChatId: string | null;
  messages: StreamMsg[];
  loadingMsgs: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  streamingChats: Set<string>;
  waitingChats: Set<string>;
  limitHitChats: Map<string, LimitHitInfo>;
  lastUsage: UsageInfo | null;
  wsDisconnected: boolean;
  setWsDisconnected: (v: boolean) => void;
  workspaces: WorkspaceItem[];
  selectChat: (id: string, closeDrawer?: () => void) => Promise<void>;
  sendMessage: (text: string, files?: File[]) => Promise<void>;
  newChat: () => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  setWorkspace: (id: string, workspace: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  deleteMessage: (chatId: string, messageId: string) => Promise<void>;
  changeModel: (model: string) => Promise<void>;
  stopStream: (id: string) => Promise<void>;
  logout: () => void;
  loadOlderMessages: () => Promise<void>;
  loadAllMessages: () => Promise<void>;
  dismissLimitHit: (chatId: string) => void;
  clearMessages: () => void;
  forceScrollRef: React.MutableRefObject<boolean>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const token = localStorage.getItem("token") ?? "";

  const [user, setUser] = useState<UserOut | null>(null);
  const [chats, setChats] = useState<ChatOut[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StreamMsg[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [streamingChats, setStreamingChats] = useState<Set<string>>(new Set());
  const [waitingChats, setWaitingChats] = useState<Set<string>>(new Set());
  const [limitHitChats, setLimitHitChats] = useState<Map<string, LimitHitInfo>>(new Map());
  const [lastUsage, setLastUsage] = useState<UsageInfo | null>(null);

  const [wsDisconnected, setWsDisconnected] = useState(false);

  const wsMapRef = useRef<Map<string, WebSocket>>(new Map());
  /** One reconnect timer per chat — background streams must reconnect too. */
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Counts consecutive failed reconnect attempts per chat. */
  const reconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  /** Tracks “assistant hasn’t finished (done/error/limit)” so we don’t drop stream state on socket close. */
  const assistantTurnPendingRef = useRef<Set<string>>(new Set());
  /** Pending prompts not yet acknowledged by backend — persisted to localStorage for reload resilience. */
  const pendingPromptsRef = useRef<Map<string, { prompt: string; filePath: string | null }>>(new Map());
  /** Timers started after “ready” event to resend pending prompt if backend doesn’t ack. */
  const readyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const activeChatIdRef = useRef<string | null>(null);
  const openWSRef = useRef<(id: string) => void>(() => {});
  const selectChatRef = useRef<(id: string) => void>(() => {});
  const forceScrollRef = useRef<boolean>(false);
  // Accumulated background streaming messages for non-active chats
  const bgMessagesRef = useRef<Map<string, StreamMsg[]>>(new Map());

  function clearReconnectTimer(chatId: string) {
    const existing = reconnectTimersRef.current.get(chatId);
    if (existing !== undefined) {
      clearTimeout(existing);
      reconnectTimersRef.current.delete(chatId);
    }
  }

  function clearPending(chatId: string) {
    pendingPromptsRef.current.delete(chatId);
    localStorage.removeItem(`chat_pending:${chatId}`);
    const t = readyTimersRef.current.get(chatId);
    if (t !== undefined) { clearTimeout(t); readyTimersRef.current.delete(chatId); }
  }

  function savePending(chatId: string, prompt: string, filePath: string | null) {
    pendingPromptsRef.current.set(chatId, { prompt, filePath });
    localStorage.setItem(`chat_pending:${chatId}`, JSON.stringify({ prompt, filePath, sentAt: Date.now() }));
  }

  const MAX_RECONNECT_ATTEMPTS = 5;

  function scheduleReconnect(chatId: string) {
    if (reconnectTimersRef.current.has(chatId)) return;

    const attempts = (reconnectAttemptsRef.current.get(chatId) ?? 0) + 1;
    reconnectAttemptsRef.current.set(chatId, attempts);

    // After max attempts — give up, clear stream visual, show permanent error
    if (attempts > MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current.delete(chatId);
      assistantTurnPendingRef.current.delete(chatId);
      removeStreaming(chatId);
      removeWaiting(chatId);
      const clearStreaming = (msgs: StreamMsg[]) =>
        msgs.some((m) => m._streaming) ? msgs.map((m) => ({ ...m, _streaming: false })) : msgs;
      if (activeChatIdRef.current === chatId) {
        setMessages(clearStreaming);
        setWsDisconnected(true);
      }
      return;
    }

    reconnectTimersRef.current.set(
      chatId,
      setTimeout(() => {
        reconnectTimersRef.current.delete(chatId);

        const stillPending = assistantTurnPendingRef.current.has(chatId);
        const stillActive = activeChatIdRef.current === chatId;
        if (!stillPending && !stillActive) return;

        const existing = wsMapRef.current.get(chatId);
        const state = existing?.readyState ?? WebSocket.CLOSED;
        if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) return;

        openWSRef.current(chatId);
      }, 3000),
    );
  }

  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

  useEffect(() => {
    if (!token) return;
    api.me().then(setUser).catch(() => logout());
    api.workspaces().then((w) => setWorkspaces(Array.isArray(w) ? w : [])).catch(() => {});
    api.chats.list().then((loaded) => {
      setChats(Array.isArray(loaded) ? loaded : []);
      if (loaded.length > 0) {
        const savedId = localStorage.getItem("activeChatId");
        const target = savedId && loaded.find((c) => c.id === savedId) ? savedId : loaded[0].id;
        selectChatRef.current(target);
      }
    }).catch(console.error);
  }, []);

  useEffect(() => {
    return () => {
      wsMapRef.current.forEach((sock) => sock.close());
      wsMapRef.current.clear();
      reconnectTimersRef.current.forEach((t) => clearTimeout(t));
      reconnectTimersRef.current.clear();
      readyTimersRef.current.forEach((t) => clearTimeout(t));
      readyTimersRef.current.clear();
    };
  }, []);

  function addStreaming(id: string) { setStreamingChats((p) => new Set(p).add(id)); }
  function removeStreaming(id: string) { setStreamingChats((p) => { const s = new Set(p); s.delete(id); return s; }); }
  function addWaiting(id: string) { setWaitingChats((p) => new Set(p).add(id)); }
  function removeWaiting(id: string) { setWaitingChats((p) => { const s = new Set(p); s.delete(id); return s; }); }

  function openWS(chatId: string) {
    const existing = wsMapRef.current.get(chatId);
    if (existing && existing.readyState < WebSocket.CLOSING) return;

    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/${chatId}`;
    const ws = new WebSocket(wsUrl);
    wsMapRef.current.set(chatId, ws);

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const isActive = activeChatIdRef.current === chatId;

      const updateMsgs = (updater: (prev: StreamMsg[]) => StreamMsg[]) => {
        if (isActive) {
          setMessages(updater);
        } else {
          const prev = bgMessagesRef.current.get(chatId) ?? [];
          bgMessagesRef.current.set(chatId, updater(prev));
        }
      };

      const turn = assistantTurnFromServerEvent(data.type);
      if (turn === "start") assistantTurnPendingRef.current.add(chatId);
      else if (turn === "end") assistantTurnPendingRef.current.delete(chatId);

      if (data.type === "ready") {
        // Server is ready to receive. If we have a pending prompt, send it after a grace period.
        // The grace period lets catchup/thinking arrive first if backend is already processing.
        const pending = pendingPromptsRef.current.get(chatId);
        if (pending) {
          const timer = setTimeout(() => {
            readyTimersRef.current.delete(chatId);
            if (pendingPromptsRef.current.has(chatId) && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ prompt: pending.prompt, file_path: pending.filePath }));
            }
          }, 500);
          readyTimersRef.current.set(chatId, timer);
        }

      } else if (data.type === "thinking") {
        clearPending(chatId);
        addWaiting(chatId);

      } else if (data.type === "thinking_chunk") {
        removeWaiting(chatId);
        addStreaming(chatId);
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last?._streaming) {
            return [...prev.slice(0, -1), { ...last, thinking_content: (last.thinking_content ?? "") + data.content }];
          }
          return [...prev, { id: genId(), chat_id: chatId, role: "assistant", content: "", thinking_content: data.content, file_path: null, created_at: new Date().toISOString(), _streaming: true }];
        });

      } else if (data.type === "catchup") {
        // Authoritative snapshot of content accumulated so far — replace, don't append.
        clearPending(chatId);
        removeWaiting(chatId);
        addStreaming(chatId);
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last?._streaming) {
            return [...prev.slice(0, -1), { ...last, content: data.content }];
          }
          return [...prev, { id: genId(), chat_id: chatId, role: "assistant", content: data.content, thinking_content: null, file_path: null, created_at: new Date().toISOString(), _streaming: true }];
        });

      } else if (data.type === "thinking_catchup") {
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last?._streaming) {
            return [...prev.slice(0, -1), { ...last, thinking_content: data.content }];
          }
          return prev;
        });

      } else if (data.type === "chunk") {
        removeWaiting(chatId);
        addStreaming(chatId);
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last?._streaming) {
            return [...prev.slice(0, -1), { ...last, content: last.content + data.content }];
          }
          return [...prev, { id: genId(), chat_id: chatId, role: "assistant", content: data.content, thinking_content: null, file_path: null, created_at: new Date().toISOString(), _streaming: true }];
        });

      } else if (data.type === "replace") {
        // Backend post-processed the response (e.g. replaced [DOWNLOAD:...] markers)
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last) return [...prev.slice(0, -1), { ...last, content: data.content }];
          return prev;
        });

      } else if (data.type === "done") {
        clearPending(chatId);
        removeWaiting(chatId);
        removeStreaming(chatId);
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last?._streaming) return [...prev.slice(0, -1), { ...last, _streaming: false }];
          return prev;
        });
        api.chats.list().then((updated) => setChats((prev) => {
          const same = prev.length === updated.length && prev.every((c, i) => c.id === updated[i].id && c.title === updated[i].title && c.updated_at === updated[i].updated_at);
          return same ? prev : updated;
        })).catch(() => {});
        // Resync the active chat with the server so optimistic messages (client
        // genId) get their real persisted ids — otherwise delete/edit hit 404.
        if (activeChatIdRef.current === chatId) {
          api.chats.messages(chatId, { limit: PAGE_SIZE }).then((page) => {
            if (activeChatIdRef.current !== chatId) return;
            const items = Array.isArray(page.items) ? page.items : [];
            setMessages((prev) => {
              // Don't clobber older history the user has loaded above the page.
              if (prev.length > items.length) return prev;
              if (prev.some((m) => m._streaming)) return prev;
              return items;
            });
            setHasMore((prev) => prev || page.has_more);
          }).catch(() => {});
        }

      } else if (data.type === "error") {
        clearPending(chatId);
        removeWaiting(chatId);
        removeStreaming(chatId);
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          // If content was already streamed (e.g. rate-limit message), keep it and don't
          // overwrite with a generic error bubble — the streamed content is already meaningful.
          if (last?._streaming && last.content) {
            return [...prev.slice(0, -1), { ...last, _streaming: false }];
          }
          return [...prev, {
            id: genId(), chat_id: chatId, role: "assistant",
            content: `❌ ${data.content}`, thinking_content: null,
            file_path: null, created_at: new Date().toISOString(),
          }];
        });

      } else if (data.type === "stopped") {
        clearPending(chatId);
        removeWaiting(chatId);
        removeStreaming(chatId);
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last?._streaming) return [...prev.slice(0, -1), { ...last, _streaming: false }];
          return prev;
        });

      } else if (data.type === "limit_hit") {
        clearPending(chatId);
        removeWaiting(chatId);
        removeStreaming(chatId);
        setLimitHitChats((prev) => {
          const next = new Map(prev);
          next.set(chatId, { chatId, resumeAt: data.resume_at, claudeSessionId: data.claude_session_id ?? null });
          return next;
        });

      } else if (data.type === "usage") {
        setLastUsage({
          inputTokens: data.input_tokens,
          outputTokens: data.output_tokens,
          cacheReadInputTokens: data.cache_read_input_tokens ?? 0,
          cacheCreationInputTokens: data.cache_creation_input_tokens ?? 0,
          totalCostUsd: data.total_cost_usd ?? 0,
          durationMs: data.duration_ms ?? 0,
        });
        // Attach usage straight onto the streaming message bubble — don't wait
        // for the post-"done" DB resync, which races the backend's own commit.
        updateMsgs((prev) => {
          const last = prev[prev.length - 1];
          if (last?._streaming) {
            return [...prev.slice(0, -1), {
              ...last,
              input_tokens: (last.input_tokens ?? 0) + data.input_tokens,
              output_tokens: (last.output_tokens ?? 0) + data.output_tokens,
              cache_read_input_tokens: (last.cache_read_input_tokens ?? 0) + (data.cache_read_input_tokens ?? 0),
              cache_creation_input_tokens: (last.cache_creation_input_tokens ?? 0) + (data.cache_creation_input_tokens ?? 0),
              cost_usd: (last.cost_usd ?? 0) + (data.total_cost_usd ?? 0),
            }];
          }
          return prev;
        });
      } else if (data.type === "deploy_done") {
        notifications.show({
          title: "✅ Деплой завершён",
          message: data.restart
            ? "Бэкенд перезапускается, соединение восстановится автоматически..."
            : "Фронтенд обновлён, перезагрузите страницу чтобы применить изменения.",
          color: "teal",
          autoClose: data.restart ? 10000 : false,
        });
      } else if (data.type === "ping") {
        /* server keep-alive */
      }
    };

    ws.onopen = () => {
      clearReconnectTimer(chatId);
      reconnectAttemptsRef.current.delete(chatId);
      ws.send(JSON.stringify({ token }));
      if (activeChatIdRef.current === chatId) setWsDisconnected(false);
    };

    ws.onclose = () => {
      if (wsMapRef.current.get(chatId) !== ws) return;
      wsMapRef.current.delete(chatId);

      const pending = assistantTurnPendingRef.current.has(chatId);
      const isActive = activeChatIdRef.current === chatId;

      const policy = socketClosePolicy({
        assistantTurnPending: pending,
        isActiveChat: isActive,
      });

      if (policy.shouldClearStreamVisual) {
        removeStreaming(chatId);
        removeWaiting(chatId);

        const clearStreaming = (msgs: StreamMsg[]) =>
          msgs.some((m) => m._streaming) ? msgs.map((m) => ({ ...m, _streaming: false })) : msgs;
        if (isActive) {
          setMessages(clearStreaming);
        } else {
          const bg = bgMessagesRef.current.get(chatId);
          if (bg) bgMessagesRef.current.set(chatId, clearStreaming(bg));
        }
      }

      if (policy.shouldScheduleReconnect) {
        if (policy.shouldWarnDisconnected) setWsDisconnected(true);
        scheduleReconnect(chatId);
      }
    };
  }

  openWSRef.current = openWS;

  async function selectChat(chatId: string, closeDrawer?: () => void) {
    closeDrawer?.();
    localStorage.setItem("activeChatId", chatId);

    if (chatId === activeChatId) {
      const existing = wsMapRef.current.get(chatId);
      if (!existing || existing.readyState >= WebSocket.CLOSING) openWS(chatId);
      return;
    }

    setWsDisconnected(false);

    setActiveChatId(chatId);
    activeChatIdRef.current = chatId;

    // Restore background-accumulated messages if available
    const bgMsgs = bgMessagesRef.current.get(chatId);
    if (bgMsgs) {
      setMessages(bgMsgs);
      setHasMore(false);
      bgMessagesRef.current.delete(chatId);
      openWS(chatId);
      return;
    }

    setMessages([]);
    setHasMore(false);
    setLoadingMsgs(true);
    try {
      const page = await api.chats.messages(chatId, { limit: PAGE_SIZE });
      const items = Array.isArray(page.items) ? page.items : [];
      setMessages(items);
      setHasMore(page.has_more);

      // Restore pending message if page was reloaded mid-send
      const pendingRaw = localStorage.getItem(`chat_pending:${chatId}`);
      if (pendingRaw) {
        try {
          const pending = JSON.parse(pendingRaw) as { prompt: string; filePath: string | null; sentAt: number };
          if (Date.now() - pending.sentAt < 3600_000) {
            const lastMsg = items[items.length - 1];
            if (!lastMsg || lastMsg.role === "assistant") {
              // Stale — already answered or empty
              localStorage.removeItem(`chat_pending:${chatId}`);
            } else if (lastMsg.role === "user" && lastMsg.content === pending.prompt) {
              // Backend received it, may still be processing
              localStorage.removeItem(`chat_pending:${chatId}`);
              assistantTurnPendingRef.current.add(chatId);
              addWaiting(chatId);
            } else {
              // Backend never got it — restore message in UI and resend on WS connect
              pendingPromptsRef.current.set(chatId, { prompt: pending.prompt, filePath: pending.filePath });
              assistantTurnPendingRef.current.add(chatId);
              forceScrollRef.current = true;
              setMessages((prev) => [...prev, {
                id: genId(), chat_id: chatId, role: "user",
                content: pending.prompt, thinking_content: null,
                file_path: pending.filePath,
                created_at: new Date(pending.sentAt).toISOString(),
              }]);
              addWaiting(chatId);
            }
          } else {
            localStorage.removeItem(`chat_pending:${chatId}`);
          }
        } catch {
          localStorage.removeItem(`chat_pending:${chatId}`);
        }
      }
    } catch {
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
    openWS(chatId);
  }

  selectChatRef.current = selectChat;

  const loadOlderMessages = useCallback(async () => {
    if (!activeChatId || loadingMore || !hasMore) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    setLoadingMore(true);
    try {
      const page = await api.chats.messages(activeChatId, { limit: PAGE_SIZE, before_id: oldestId });
      setMessages((prev) => [...page.items, ...prev]);
      setHasMore(page.has_more);
    } finally {
      setLoadingMore(false);
    }
  }, [activeChatId, loadingMore, hasMore, messages]);

  const loadAllMessages = useCallback(async () => {
    if (!activeChatId || loadingMore) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    setLoadingMore(true);
    try {
      const page = await api.chats.messages(activeChatId, { before_id: oldestId, all: true });
      setMessages((prev) => [...page.items, ...prev]);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [activeChatId, loadingMore, messages]);

  async function newChat() {
    const chat = await api.chats.create();
    setChats((prev) => [chat, ...prev]);
    await selectChat(chat.id);
  }

  async function renameChat(id: string, title: string) {
    const updated = await api.chats.rename(id, title);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...updated, message_count: c.message_count } : c)));
  }

  async function setWorkspace(id: string, workspace: string) {
    const updated = await api.chats.setWorkspace(id, workspace);
    setChats((prev) => prev.map((c) => (c.id === id ? { ...updated, message_count: c.message_count } : c)));
  }

  async function stopStream(id: string) {
    removeWaiting(id);
    removeStreaming(id);
    try {
      await api.chats.stop(id);
    } catch { /* ignore */ }
  }

  async function deleteChat(id: string) {
    await api.chats.delete(id);
    clearReconnectTimer(id);
    clearPending(id);
    assistantTurnPendingRef.current.delete(id);
    const ws = wsMapRef.current.get(id);
    if (ws) { ws.close(); wsMapRef.current.delete(id); }
    bgMessagesRef.current.delete(id);
    removeStreaming(id);
    removeWaiting(id);
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (activeChatId === id) {
      localStorage.removeItem("activeChatId");
      setActiveChatId(null);
      activeChatIdRef.current = null;
      setMessages([]);
      setHasMore(false);
    }
  }

  async function deleteMessage(chatId: string, messageId: string) {
    // Optimistic remove; the server is the source of truth on failure.
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    try {
      await api.chats.deleteMessage(chatId, messageId);
    } catch {
      // The id may be a not-yet-persisted optimistic entry, or already gone.
      // Resync from the server so the UI reflects real state.
      if (activeChatIdRef.current === chatId) {
        try {
          const page = await api.chats.messages(chatId, { limit: PAGE_SIZE });
          setMessages(Array.isArray(page.items) ? page.items : []);
          setHasMore(page.has_more);
        } catch { /* ignore */ }
      }
    }
  }

  const changeModel = useCallback(async (model: string) => {
    const updated = await api.updateMe({ model });
    setUser(updated);
  }, []);


  function dismissLimitHit(chatId: string) {
    setLimitHitChats((prev) => { const next = new Map(prev); next.delete(chatId); return next; });
  }

  function clearMessages() {
    setMessages([]);
    setHasMore(false);
  }

  function logout() {
    reconnectTimersRef.current.forEach((t) => clearTimeout(t));
    reconnectTimersRef.current.clear();
    readyTimersRef.current.forEach((t) => clearTimeout(t));
    readyTimersRef.current.clear();
    assistantTurnPendingRef.current.clear();
    pendingPromptsRef.current.clear();
    Object.keys(localStorage).filter((k) => k.startsWith("chat_pending:")).forEach((k) => localStorage.removeItem(k));
    wsMapRef.current.forEach((sock) => sock.close());
    wsMapRef.current.clear();
    localStorage.removeItem("token");
    navigate("/login", { replace: true });
  }

  const isActiveChatBusy = activeChatId
    ? streamingChats.has(activeChatId) || waitingChats.has(activeChatId)
    : false;

  const sendMessage = useCallback(async (text: string, files?: File[]) => {
    if (!activeChatId || isActiveChatBusy) return;

    const paths: string[] = [];
    if (files && files.length > 0) {
      for (const f of files) {
        try {
          const res = await api.uploadFile(activeChatId, f, text);
          paths.push(res.file_path);
        } catch {
          return;
        }
      }
    }

    const storedFilePath = paths.length > 1
      ? JSON.stringify(paths)
      : (paths[0] ?? null);

    addWaiting(activeChatId);
    assistantTurnPendingRef.current.add(activeChatId);

    forceScrollRef.current = true;
    setMessages((prev) => [...prev, {
      id: genId(), chat_id: activeChatId, role: "user",
      content: text, thinking_content: null, file_path: storedFilePath,
      created_at: new Date().toISOString(),
    }]);

    const chatId = activeChatId;
    const payload = JSON.stringify({ prompt: text, file_paths: paths });
    const ws = wsMapRef.current.get(chatId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      openWS(chatId);
      // pending will be sent via "ready" event → 500ms grace period in onmessage
    }
  }, [activeChatId, isActiveChatBusy]);

  return (
    <ChatContext.Provider value={{
      user, chats, activeChatId, messages, loadingMsgs,
      hasMore, loadingMore,
      streamingChats, waitingChats, limitHitChats, lastUsage, wsDisconnected, setWsDisconnected,
      workspaces,
      selectChat, sendMessage, newChat, renameChat, setWorkspace, deleteChat, deleteMessage, changeModel, stopStream, logout,
      loadOlderMessages, loadAllMessages, dismissLimitHit, clearMessages, forceScrollRef,
    }}>
      {children}
    </ChatContext.Provider>
  );
}
