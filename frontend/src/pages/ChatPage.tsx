import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Box, ScrollArea, Stack, Text, Center,
  Loader, Group, Drawer, Burger, Button, Alert, Select,
  Modal, Progress, Badge, Tooltip, Popover,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { useNavigate } from "react-router-dom";
import { IconMessages, IconHistory, IconClock, IconCheck, IconX, IconWifiOff, IconFolder, IconTrash } from "@tabler/icons-react";
import { useChatContext } from "../lib/ChatContext";
import { api } from "../lib/api";
import type { QueueTaskOut } from "../lib/api";
import Sidebar from "../components/Sidebar";
import MessageBubble from "../components/MessageBubble";
import QueueTaskBubble from "../components/QueueTaskBubble";
import InputArea from "../components/InputArea";
import ThemeToggle from "../components/ThemeToggle";
import { FALLBACK_MODELS, fetchModelOptions, fetchAvailableModelOptions, type ModelOption } from "../lib/models";

export default function ChatPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [drawerOpen, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [schedulingChatId, setSchedulingChatId] = useState<string | null>(null);
  const [usageModalOpen, { open: openUsageModal, close: closeUsageModal }] = useDisclosure(false);
  const [usageData, setUsageData] = useState<{
    plan: string;
    five_hour: { utilization: number; resets_at: string } | null;
    seven_day: { utilization: number; resets_at: string } | null;
    extra_usage: { is_enabled: boolean; used_credits: number | null; monthly_limit: number | null; currency: string | null } | null;
    limits: Array<{ kind: string; percent: number; severity: string; resets_at: string; scope: { model: { id: string | null; display_name: string }; surface: null } | null; is_active: boolean }> | null;
  } | null>(null);

  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(FALLBACK_MODELS);

  useEffect(() => {
    fetchModelOptions().then(setModels);
    fetchAvailableModelOptions().then(setAvailableModels);
  }, []);

  const CONTEXT_MAX = 50;

  const getContextColor = (count: number) => {
    if (count >= CONTEXT_MAX) return "red";
    if (count >= 40) return "orange";
    if (count >= 25) return "yellow";
    return "teal";
  };

  const {
    user, chats, activeChatId, messages, loadingMsgs,
    hasMore, loadingMore,
    streamingChats, waitingChats, limitHitChats, wsDisconnected, setWsDisconnected,
    workspaces,
    selectChat, sendMessage, newChat, renameChat, setWorkspace, deleteChat, deleteMessage, logout, stopStream,
    loadOlderMessages, loadAllMessages, dismissLimitHit, forceScrollRef, clearMessages, changeModel,
  } = useChatContext();

  const timeUntil = (iso: string): string => {
    const delta = Math.max(0, new Date(iso).getTime() - Date.now());
    const d = Math.floor(delta / 86400000);
    const h = Math.floor((delta % 86400000) / 3600000);
    const m = Math.floor((delta % 3600000) / 60000);
    if (d > 0) return `${d}д ${h}ч`;
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
  };

  // Queue tasks for active chat (pending + running)
  const [queueTasks, setQueueTasks] = useState<QueueTaskOut[]>([]);

  const fetchTasks = useCallback(async (chatId: string) => {
    try {
      const [pending, running] = await Promise.all([
        api.queue.tasks({ chat_id: chatId, status: "pending" }),
        api.queue.tasks({ chat_id: chatId, status: "running" }),
      ]);
      const next = [...pending, ...running].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      setQueueTasks((prev) => {
        const sameIds = prev.length === next.length && prev.every((t, i) => t.id === next[i].id && t.status === next[i].status);
        return sameIds ? prev : next;
      });
    } catch {
      // silently ignore — not critical
    }
  }, []);

  useEffect(() => {
    if (!activeChatId) { setQueueTasks([]); return; }
    fetchTasks(activeChatId);
    const interval = setInterval(() => fetchTasks(activeChatId), 30_000);
    return () => clearInterval(interval);
  }, [activeChatId, fetchTasks]);

  const activeChat = chats.find((c) => c.id === activeChatId);

  const chatUsageTotal = useMemo(() => {
    let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, costUsd = 0, count = 0;
    for (const m of messages) {
      if (m.cost_usd == null) continue;
      inputTokens += m.input_tokens ?? 0;
      outputTokens += m.output_tokens ?? 0;
      cacheReadTokens += m.cache_read_input_tokens ?? 0;
      costUsd += m.cost_usd;
      count += 1;
    }
    return count > 0 ? { inputTokens, outputTokens, cacheReadTokens, costUsd } : null;
  }, [messages]);

  const wsSelectData = (() => {
    const byRoot: Record<string, { value: string; label: string }[]> = {};
    for (const w of workspaces) {
      (byRoot[w.root] ??= []).push({ value: w.path, label: w.name });
    }
    return Object.entries(byRoot).map(([root, items]) => ({
      group: root.replace(/^\/home\/[^/]+\//, ""),
      items,
    }));
  })();

  const activeLimitHit = activeChatId ? limitHitChats.get(activeChatId) : undefined;

  const isActiveChatBusy = activeChatId
    ? streamingChats.has(activeChatId) || waitingChats.has(activeChatId)
    : false;

  const processingChatIds = useMemo(
    () => new Set([...streamingChats, ...waitingChats]),
    [streamingChats, waitingChats]
  );

  // --- scroll management ---
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  // Track message list identity to decide scroll behavior
  const prevFirstIdRef = useRef<string | null>(null);
  const prevCountRef = useRef<number>(0);
  // Saved scroll offset (scrollHeight - scrollTop) before prepend
  const savedScrollOffsetRef = useRef<number | null>(null);

  // Stable refs for IntersectionObserver callback (avoid stale closures)
  const hasMoreRef = useRef(hasMore);
  const loadingMoreRef = useRef(loadingMore);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);

  // Smart scroll: instant-to-bottom on initial load, restore on prepend, auto-scroll on append
  useLayoutEffect(() => {
    const vp = scrollViewportRef.current;
    if (!vp) return;

    if (messages.length === 0) {
      prevFirstIdRef.current = null;
      prevCountRef.current = 0;
      return;
    }

    const firstId = messages[0].id;
    const prevFirstId = prevFirstIdRef.current;
    const prevCount = prevCountRef.current;

    if (prevCount === 0) {
      // Initial load — jump to bottom instantly
      vp.scrollTop = vp.scrollHeight;
    } else if (firstId !== prevFirstId) {
      // Older messages prepended — restore position relative to previous content
      if (savedScrollOffsetRef.current !== null) {
        vp.scrollTop = vp.scrollHeight - savedScrollOffsetRef.current;
        savedScrollOffsetRef.current = null;
      }
    } else if (messages.length > prevCount) {
      // New messages appended — always scroll if user just sent a message, otherwise only if near bottom
      const distFromBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
      if (forceScrollRef.current || distFromBottom < 200) {
        vp.scrollTop = vp.scrollHeight;
        forceScrollRef.current = false;
      }
    }

    prevFirstIdRef.current = firstId;
    prevCountRef.current = messages.length;
  }, [messages]);

  // IntersectionObserver: auto-load when top sentinel becomes visible
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const viewport = scrollViewportRef.current;
    if (!sentinel || !viewport || loadingMsgs) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreRef.current && !loadingMoreRef.current) {
          savedScrollOffsetRef.current =
            viewport.scrollHeight - viewport.scrollTop;
          loadOlderMessages();
        }
      },
      { root: viewport, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeChatId, loadingMsgs, loadOlderMessages]);

  const sidebar = (
    <Sidebar
      chats={chats}
      activeChatId={activeChatId}
      processingChatIds={processingChatIds}
      user={user}
      onSelect={(id) => selectChat(id, isMobile ? closeDrawer : undefined)}
      onNew={newChat}
      onRename={renameChat}
      onDelete={deleteChat}
      onLogout={logout}
      onAdmin={() => navigate("/admin")}
      onQueue={() => navigate("/queue")}
    />
  );

  return (
    <>
    <Box style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      {!isMobile && (
        <Box style={{
          width: 260, flexShrink: 0, display: "flex",
          flexDirection: "column", overflow: "hidden",
          borderRight: "1px solid var(--mantine-color-default-border)",
        }}>
          {sidebar}
        </Box>
      )}

      {isMobile && (
        <Drawer opened={drawerOpen} onClose={closeDrawer} size={280} padding={0} withCloseButton={false}>
          {sidebar}
        </Drawer>
      )}

      <Box style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <Group
          px="md" py="xs"
          style={{ flexShrink: 0, borderBottom: "1px solid var(--mantine-color-default-border)" }}
          justify="space-between"
          wrap="nowrap"
        >
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            {isMobile && <Burger opened={drawerOpen} onClick={openDrawer} size="sm" />}
            <Text fw={500} size="sm" c="dimmed" truncate style={{ minWidth: 0, maxWidth: 180 }}>
              {activeChat?.title ?? "Выберите чат"}
            </Text>
            {chatUsageTotal && (
              <Popover position="bottom-start" withArrow shadow="md">
                <Popover.Target>
                  <Badge
                    size="sm"
                    variant="light"
                    color="gray"
                    style={{ cursor: "pointer", flexShrink: 0 }}
                  >
                    ${chatUsageTotal.costUsd.toFixed(2)}
                  </Badge>
                </Popover.Target>
                <Popover.Dropdown>
                  <Text size="xs" c="dimmed">
                    {chatUsageTotal.inputTokens.toLocaleString()} in · {chatUsageTotal.outputTokens.toLocaleString()} out
                    {chatUsageTotal.cacheReadTokens > 0 && ` · ${chatUsageTotal.cacheReadTokens.toLocaleString()} cached`}
                  </Text>
                  <Text size="xs" fw={500} mt={2}>
                    Итого по чату: ${chatUsageTotal.costUsd.toFixed(4)}
                  </Text>
                </Popover.Dropdown>
              </Popover>
            )}
          </Group>
          <Group gap="xs" wrap="nowrap">
            {activeChatId && wsSelectData.length > 0 && (
              <Select
                size="xs"
                leftSection={<IconFolder size={13} />}
                placeholder="workspace"
                data={wsSelectData}
                value={activeChat?.workspace ?? null}
                onChange={(val) => val && activeChatId && setWorkspace(activeChatId, val)}
                disabled={isActiveChatBusy}
                styles={{ input: { minWidth: 160, maxWidth: 220 } }}
                comboboxProps={{ shadow: "md" }}
                allowDeselect={false}
              />
            )}
            {activeChatId && messages.length > 0 && (
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                px={6}
                title="Очистить чат"
                disabled={isActiveChatBusy}
                onClick={clearMessages}
              >
                <IconTrash size={15} />
              </Button>
            )}
            <ThemeToggle />
          </Group>
        </Group>

        {activeChatId && (() => {
          const msgCount = Math.max(activeChat?.message_count ?? 0, messages.length);
          const pct = Math.min(100, (msgCount / CONTEXT_MAX) * 100);
          const color = getContextColor(msgCount);
          return (
            <Tooltip
              label={`${msgCount} сообщений — ${msgCount >= CONTEXT_MAX ? "рекомендуем начать новый чат" : `до лимита ещё ${CONTEXT_MAX - msgCount}`}`}
              position="bottom"
              withArrow
            >
              <Box style={{ height: 3, background: "var(--mantine-color-default-border)", flexShrink: 0, cursor: "default" }}>
                <Box
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: `var(--mantine-color-${color}-5)`,
                    transition: "width 0.4s ease, background 0.4s ease",
                  }}
                />
              </Box>
            </Tooltip>
          );
        })()}

        <Box style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <ScrollArea
            style={{ position: "absolute", inset: 0 }}
            px="md"
            py="sm"
            viewportRef={scrollViewportRef}
          >
            {!activeChatId && (
              <Center h="100%" style={{ minHeight: 300 }}>
                <Stack align="center" gap="sm">
                  <IconMessages size={48} opacity={0.3} />
                  <Text c="dimmed">Выберите чат или создайте новый</Text>
                </Stack>
              </Center>
            )}

            {/* Top sentinel — triggers auto-load on scroll up */}
            <div ref={topSentinelRef} />

            {/* History controls shown at the top when there are older messages */}
            {hasMore && (
              <Center py="xs">
                {loadingMore ? (
                  <Loader size="xs" color="dimmed" />
                ) : (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    leftSection={<IconHistory size={13} />}
                    onClick={() => {
                      const vp = scrollViewportRef.current;
                      if (vp) savedScrollOffsetRef.current = vp.scrollHeight - vp.scrollTop;
                      loadAllMessages();
                    }}
                  >
                    Загрузить всю историю
                  </Button>
                )}
              </Center>
            )}

            {loadingMsgs && <Center py="xl"><Loader size="sm" /></Center>}

            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={msg._streaming}
                onDelete={activeChatId ? (id) => deleteMessage(activeChatId, id) : undefined}
              />
            ))}

            {/* Deferred / running queue tasks shown after all messages */}
            {queueTasks
              .filter((t) => !(t.status === "running" && (
                waitingChats.has(t.chat_id) || streamingChats.has(t.chat_id)
              )))
              .map((task) => (
                <QueueTaskBubble
                  key={task.id}
                  task={task}
                  onCancelled={(id) => setQueueTasks((prev) => prev.filter((t) => t.id !== id))}
                  onStarted={() => activeChatId && fetchTasks(activeChatId)}
                />
              ))}

            {activeChatId && waitingChats.has(activeChatId) && (
              <MessageBubble
                message={{ id: "thinking", chat_id: activeChatId, role: "assistant", content: "", thinking_content: null, file_path: null, created_at: new Date().toISOString() }}
                isThinking
              />
            )}

            <div ref={bottomRef} />
          </ScrollArea>
        </Box>

        {wsDisconnected && activeChatId && (
          <Alert
            icon={<IconWifiOff size={16} />}
            color="red"
            mx="md"
            mb="xs"
            variant="light"
            withCloseButton
            onClose={() => setWsDisconnected(false)}
            closeButtonLabel="Закрыть"
          >
            <Text size="sm">
              {isActiveChatBusy
                ? "Сервер недоступен — ответ прерван. Попробуйте отправить сообщение снова."
                : "Соединение потеряно — переподключение..."}
            </Text>
          </Alert>
        )}

        {activeLimitHit && (
          <Alert
            icon={<IconClock size={16} />}
            color="orange"
            mx="md"
            mb="xs"
            withCloseButton
            onClose={() => dismissLimitHit(activeLimitHit.chatId)}
            closeButtonLabel="Закрыть"
          >
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">
                Достигнут лимит Claude. Запланировать продолжение на{" "}
                <strong>
                  {new Date(activeLimitHit.resumeAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                </strong>
                ?
              </Text>
              <Group gap="xs" wrap="nowrap">
                <Button
                  size="xs"
                  color="green"
                  leftSection={<IconCheck size={13} />}
                  loading={schedulingChatId === activeLimitHit.chatId}
                  onClick={async () => {
                    setSchedulingChatId(activeLimitHit.chatId);
                    try {
                      await api.queue.createTask({
                        chat_id: activeLimitHit.chatId,
                        prompt: "Continue",
                        claude_session_id: activeLimitHit.claudeSessionId,
                        resume_at: activeLimitHit.resumeAt,
                      });
                      dismissLimitHit(activeLimitHit.chatId);
                      navigate("/queue");
                    } finally {
                      setSchedulingChatId(null);
                    }
                  }}
                >
                  Да, запланировать
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconX size={13} />}
                  onClick={() => dismissLimitHit(activeLimitHit.chatId)}
                >
                  Нет
                </Button>
              </Group>
            </Group>
          </Alert>
        )}

        <InputArea
          onSend={async (text, files) => {
            const trimmed = text.trim();
            if (trimmed === "/usage") {
              try {
                const data = await api.usage();
                setUsageData(data);
                openUsageModal();
              } catch {
                notifications.show({ title: "Usage", message: "Не удалось получить статистику", color: "red" });
              }
              return;
            }
            if (trimmed === "/vpn-status") {
              try {
                const r = await api.vpn.status();
                const out = [r.stdout, r.stderr].filter(Boolean).join("\n") || "Нет вывода";
                notifications.show({
                  title: "VPN Status",
                  message: out,
                  color: r.returncode === 0 ? "teal" : "red",
                  autoClose: false,
                });
              } catch (e: unknown) {
                notifications.show({ title: "VPN Status", message: String(e), color: "red", autoClose: false });
              }
              return;
            }
            if (trimmed === "/vpn-disconnect") {
              try {
                const r = await api.vpn.disconnect();
                const out = [r.stdout, r.stderr].filter(Boolean).join("\n") || "Выполнено";
                notifications.show({
                  title: "VPN Disconnect",
                  message: out,
                  color: r.returncode === 0 ? "teal" : "red",
                  autoClose: 8000,
                });
              } catch (e: unknown) {
                notifications.show({ title: "VPN Disconnect", message: String(e), color: "red" });
              }
              return;
            }
            if (trimmed.startsWith("/vpn-connect")) {
              const suffix = trimmed.slice("/vpn-connect".length).trim();
              try {
                const r = await api.vpn.connect(suffix);
                const out = [r.stdout, r.stderr].filter(Boolean).join("\n") || "Выполнено";
                notifications.show({
                  title: "VPN Connect",
                  message: out,
                  color: r.returncode === 0 ? "teal" : "red",
                  autoClose: r.returncode === 0 ? 8000 : false,
                });
              } catch (e: unknown) {
                notifications.show({ title: "VPN Connect", message: String(e), color: "red" });
              }
              return;
            }
            sendMessage(text, files);
          }}
          onStop={() => activeChatId && stopStream?.(activeChatId)}
          disabled={!activeChatId}
          streaming={isActiveChatBusy}
          model={user?.model}
          models={models}
          availableModels={availableModels}
          onChangeModel={changeModel}
        />
      </Box>
    </Box>

    <Modal opened={usageModalOpen} onClose={closeUsageModal} title="Account & Usage" size="sm">
      {usageData && (
        <Stack gap="md">
          <Group gap="xs">
            <Text size="sm" c="dimmed">Plan:</Text>
            <Badge variant="light" color="violet">{usageData.plan}</Badge>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed">Auth:</Text>
            <Text size="sm">Claude AI</Text>
          </Group>

          {usageData.five_hour && (
            <Box>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={500}>Session (5hr)</Text>
                <Text size="sm" c="dimmed">{usageData.five_hour.utilization.toFixed(0)}%</Text>
              </Group>
              <Progress value={usageData.five_hour.utilization} color={usageData.five_hour.utilization > 80 ? "red" : usageData.five_hour.utilization > 50 ? "yellow" : "teal"} size="md" radius="sm" />
              <Text size="xs" c="dimmed" mt={4}>Resets in {timeUntil(usageData.five_hour.resets_at)}</Text>
            </Box>
          )}

          {usageData.seven_day && (
            <Box>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={500}>Weekly (7 day)</Text>
                <Text size="sm" c="dimmed">{usageData.seven_day.utilization.toFixed(0)}%</Text>
              </Group>
              <Progress value={usageData.seven_day.utilization} color={usageData.seven_day.utilization > 80 ? "red" : usageData.seven_day.utilization > 50 ? "yellow" : "blue"} size="md" radius="sm" />
              <Text size="xs" c="dimmed" mt={4}>Resets in {timeUntil(usageData.seven_day.resets_at)}</Text>
            </Box>
          )}

          {usageData.limits?.filter((l) => l.scope !== null).map((l) => (
            <Box key={l.kind}>
              <Group justify="space-between" mb={4}>
                <Text size="sm" fw={500}>{l.scope!.model.display_name} (неделя)</Text>
                <Text size="sm" c="dimmed">{l.percent.toFixed(0)}%</Text>
              </Group>
              <Progress
                value={l.percent}
                color={l.percent > 80 ? "red" : l.percent > 50 ? "yellow" : "grape"}
                size="md" radius="sm"
              />
              <Text size="xs" c="dimmed" mt={4}>Resets in {timeUntil(l.resets_at)}</Text>
            </Box>
          ))}

          {usageData.extra_usage?.is_enabled && (
            <Box>
              <Text size="sm" fw={500} mb={4}>Extra usage</Text>
              <Text size="sm">{usageData.extra_usage.used_credits ?? 0} / {usageData.extra_usage.monthly_limit ?? "∞"} {usageData.extra_usage.currency ?? "USD"}</Text>
            </Box>
          )}

          <Text size="xs" c="dimmed" ta="center">
            Manage usage on claude.ai
          </Text>
        </Stack>
      )}
    </Modal>
    </>
  );
}
