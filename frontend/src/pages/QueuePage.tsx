import { useEffect, useState, useCallback } from "react";
import {
  Box, Stack, Text, Group, Button, Badge, Select, ScrollArea,
  Table, ActionIcon, Loader, Center, Title, TextInput, Paper,
  Tooltip, Alert, Modal, Textarea,
} from "@mantine/core";
import { useNavigate } from "react-router-dom";
import {
  IconArrowLeft, IconTrash, IconPlayerPlay, IconX, IconClock,
  IconRefresh, IconAlertCircle, IconPlus,
} from "@tabler/icons-react";
import { api } from "../lib/api";
import type { QueueTaskOut, QueueScheduleOut, ChatOut } from "../lib/api";
import { FALLBACK_MODELS, fetchModelOptions, modelLabel, type ModelOption } from "../lib/models";

const STATUS_COLOR: Record<string, string> = {
  pending: "blue",
  running: "yellow",
  done: "green",
  error: "red",
  cancelled: "gray",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Ожидает",
  running: "Выполняется",
  done: "Готово",
  error: "Ошибка",
  cancelled: "Отменено",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function SchedulePanel({ chatId, chatTitle }: { chatId: string; chatTitle: string }) {
  const [schedule, setSchedule] = useState<QueueScheduleOut | null>(null);
  const [mode, setMode] = useState("auto");
  const [windowFrom, setWindowFrom] = useState("22:00");
  const [windowTo, setWindowTo] = useState("08:00");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.queue.getSchedule(chatId).then((s) => {
      setSchedule(s);
      setMode(s.mode);
      if (s.window_from) setWindowFrom(s.window_from);
      if (s.window_to) setWindowTo(s.window_to);
    }).catch(() => {});
  }, [chatId]);

  async function save() {
    setSaving(true);
    try {
      const updated = await api.queue.updateSchedule(chatId, {
        mode,
        window_from: mode === "window" ? windowFrom : null,
        window_to: mode === "window" ? windowTo : null,
      });
      setSchedule(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
    } finally {
      setSaving(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Text fw={500} size="sm">{chatTitle}</Text>
        <Select
          label="Режим запуска"
          value={mode}
          onChange={(v) => setMode(v ?? "auto")}
          data={[
            { value: "auto", label: "Авто — запускать при сбросе лимита" },
            { value: "window", label: "По расписанию — только в заданное время" },
            { value: "manual", label: "Вручную — только по кнопке" },
          ]}
          size="sm"
        />
        {mode === "window" && (
          <Group grow>
            <TextInput
              label="С (HH:MM)"
              value={windowFrom}
              onChange={(e) => setWindowFrom(e.target.value)}
              placeholder="22:00"
              size="sm"
            />
            <TextInput
              label="До (HH:MM)"
              value={windowTo}
              onChange={(e) => setWindowTo(e.target.value)}
              placeholder="08:00"
              size="sm"
            />
          </Group>
        )}
        <Button
          size="xs"
          onClick={save}
          loading={saving}
          color={saved ? "green" : "blue"}
        >
          {saved ? "Сохранено" : "Сохранить"}
        </Button>
      </Stack>
    </Paper>
  );
}

function CreateTaskModal({ chats, models, onCreated, onClose }: { chats: ChatOut[]; models: ModelOption[]; onCreated: () => void; onClose: () => void }) {
  const [chatId, setChatId] = useState<string | null>(chats[0]?.id ?? null);
  const [prompt, setPrompt] = useState("Continue");
  const [model, setModel] = useState<string | null>(null);
  const [resumeAt, setResumeAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!chatId) return;
    setSaving(true);
    setErr(null);
    try {
      await api.queue.createTask({
        chat_id: chatId,
        prompt: prompt.trim() || "Continue",
        model: model || null,
        resume_at: resumeAt ? new Date(resumeAt).toISOString() : null,
      });
      onCreated();
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="sm">
      {err && <Alert color="red" icon={<IconAlertCircle size={16} />}>{err}</Alert>}
      <Select
        label="Чат"
        data={chats.map((c) => ({ value: c.id, label: c.title }))}
        value={chatId}
        onChange={setChatId}
        searchable
        required
      />
      <Textarea
        label="Запрос"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        autosize
        minRows={3}
        placeholder="Введите текст запроса..."
      />
      <Select
        label="Модель"
        description="Оставьте пустым — будет использована модель профиля"
        data={models}
        value={model}
        onChange={setModel}
        clearable
        placeholder="По умолчанию (из профиля)"
      />
      <TextInput
        label="Запустить не раньше (необязательно)"
        description="Оставьте пустым для немедленного запуска"
        type="datetime-local"
        value={resumeAt}
        onChange={(e) => setResumeAt(e.target.value)}
      />
      <Group justify="flex-end" mt="xs">
        <Button variant="subtle" onClick={onClose}>Отмена</Button>
        <Button onClick={submit} loading={saving} disabled={!chatId}>Добавить в очередь</Button>
      </Group>
    </Stack>
  );
}

export default function QueuePage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<QueueTaskOut[]>([]);
  const [chats, setChats] = useState<ChatOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);

  const chatMap = Object.fromEntries(chats.map((c) => [c.id, c.title]));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, c] = await Promise.all([
        api.queue.tasks(statusFilter === "active" ? { status: "pending" } : statusFilter !== "all" ? { status: statusFilter } : {}),
        api.chats.list(),
      ]);
      // For active: also fetch running
      if (statusFilter === "active") {
        const running = await api.queue.tasks({ status: "running" });
        setTasks([...running, ...t]);
      } else {
        setTasks(t);
      }
      setChats(c);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchModelOptions().then(setModels); }, []);

  async function runNow(task: QueueTaskOut) {
    setActionLoading(task.id);
    try {
      await api.queue.runNow(task.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteTask(task: QueueTaskOut) {
    setActionLoading(task.id);
    try {
      await api.queue.deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setActionLoading(null);
    }
  }

  async function cancelTask(task: QueueTaskOut) {
    setActionLoading(task.id);
    try {
      await api.queue.cancelTask(task.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setActionLoading(null);
    }
  }

  // Unique chats that have pending/running tasks (for schedule panel)
  const activeChatIds = [...new Set(
    tasks.filter((t) => t.status === "pending" || t.status === "running").map((t) => t.chat_id)
  )];

  return (
    <Box style={{ display: "flex", height: "100dvh", flexDirection: "column", overflow: "hidden" }}>
      <Modal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Новая задача в очереди"
        size="md"
      >
        <CreateTaskModal
          chats={chats}
          models={models}
          onCreated={load}
          onClose={() => setCreateOpen(false)}
        />
      </Modal>

      <Group
        px="md" py="xs"
        style={{ flexShrink: 0, borderBottom: "1px solid var(--mantine-color-default-border)" }}
      >
        <ActionIcon variant="subtle" onClick={() => navigate("/")}>
          <IconArrowLeft size={16} />
        </ActionIcon>
        <Title order={5}>Очередь задач</Title>
        <Group gap="xs" ml="auto">
          <Button
            size="xs"
            leftSection={<IconPlus size={13} />}
            onClick={() => setCreateOpen(true)}
          >
            Добавить задачу
          </Button>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size={13} />}
            onClick={load}
            loading={loading}
          >
            Обновить
          </Button>
        </Group>
      </Group>

      <Box style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0 }}>
        {/* Task list */}
        <Box style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Group px="md" py="xs" gap="xs" style={{ flexShrink: 0 }}>
            {["active", "done", "error", "all"].map((s) => (
              <Button
                key={s}
                size="xs"
                variant={statusFilter === s ? "filled" : "subtle"}
                onClick={() => setStatusFilter(s)}
              >
                {{ active: "Активные", done: "Выполненные", error: "Ошибки", all: "Все" }[s]}
              </Button>
            ))}
          </Group>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} color="red" mx="md" mb="xs" onClose={() => setError(null)} withCloseButton>
              {error}
            </Alert>
          )}

          <ScrollArea style={{ flex: 1 }} px="md">
            {loading && tasks.length === 0 ? (
              <Center py="xl"><Loader size="sm" /></Center>
            ) : tasks.length === 0 ? (
              <Center py="xl">
                <Text c="dimmed" size="sm">Нет задач</Text>
              </Center>
            ) : (
              <Table highlightOnHover verticalSpacing="xs" fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Чат</Table.Th>
                    <Table.Th>Запрос</Table.Th>
                    <Table.Th>Модель</Table.Th>
                    <Table.Th>Статус</Table.Th>
                    <Table.Th>Запуск</Table.Th>
                    <Table.Th>Создано</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {tasks.map((task) => (
                    <Table.Tr key={task.id}>
                      <Table.Td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <Tooltip label={chatMap[task.chat_id] ?? task.chat_id} openDelay={400}>
                          <Text size="sm" truncate>{chatMap[task.chat_id] ?? "—"}</Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td style={{ maxWidth: 200 }}>
                        <Tooltip label={task.prompt} openDelay={400} disabled={task.prompt.length < 40}>
                          <Text size="sm" truncate>{task.prompt}</Text>
                        </Tooltip>
                        {task.error && (
                          <Text size="xs" c="red" truncate>{task.error}</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {task.model
                            ? modelLabel(models, task.model).split(" · ")[0]
                            : <Text span c="dimmed" fs="italic">из профиля</Text>
                          }
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge size="sm" color={STATUS_COLOR[task.status] ?? "gray"}>
                          {STATUS_LABEL[task.status] ?? task.status}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {task.resume_at ? (
                          <Group gap={4} wrap="nowrap">
                            <IconClock size={12} />
                            <Text size="xs">{formatDate(task.resume_at)}</Text>
                          </Group>
                        ) : (
                          <Text size="xs" c="dimmed">ASAP</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">{formatDate(task.created_at)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          {task.status === "pending" && (
                            <Tooltip label="Запустить сейчас">
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="green"
                                loading={actionLoading === task.id}
                                onClick={() => runNow(task)}
                              >
                                <IconPlayerPlay size={13} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {task.status === "pending" && (
                            <Tooltip label="Отменить">
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="orange"
                                loading={actionLoading === task.id}
                                onClick={() => cancelTask(task)}
                              >
                                <IconX size={13} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                          {task.status !== "running" && (
                            <Tooltip label="Удалить">
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color="red"
                                loading={actionLoading === task.id}
                                onClick={() => deleteTask(task)}
                              >
                                <IconTrash size={13} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </ScrollArea>
        </Box>

        {/* Schedule panel — shown when there are active chats with tasks */}
        {activeChatIds.length > 0 && (
          <Box
            style={{
              width: 280,
              flexShrink: 0,
              borderLeft: "1px solid var(--mantine-color-default-border)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Text size="sm" fw={500} px="md" py="xs" style={{ flexShrink: 0, borderBottom: "1px solid var(--mantine-color-default-border)" }}>
              Расписание
            </Text>
            <ScrollArea style={{ flex: 1 }} p="md">
              <Stack gap="sm">
                {activeChatIds.map((cid) => (
                  <SchedulePanel key={cid} chatId={cid} chatTitle={chatMap[cid] ?? cid} />
                ))}
              </Stack>
            </ScrollArea>
          </Box>
        )}
      </Box>
    </Box>
  );
}
