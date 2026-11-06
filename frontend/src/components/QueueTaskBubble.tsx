import { useState } from "react";
import { Box, Group, Text, Badge, ActionIcon, Tooltip, Loader } from "@mantine/core";
import { IconClock, IconClockPlay, IconPlayerPlay, IconX } from "@tabler/icons-react";
import type { QueueTaskOut } from "../lib/api";
import { api } from "../lib/api";

interface Props {
  task: QueueTaskOut;
  onCancelled: (id: string) => void;
  onStarted: (id: string) => void;
}

export default function QueueTaskBubble({ task, onCancelled, onStarted }: Props) {
  const [loading, setLoading] = useState<"cancel" | "run" | null>(null);

  const isPending = task.status === "pending";
  const isRunning = task.status === "running";
  const resumeAt = task.resume_at ? new Date(task.resume_at) : null;
  const isScheduled = resumeAt && resumeAt > new Date();

  async function handleCancel() {
    setLoading("cancel");
    try {
      await api.queue.cancelTask(task.id);
      onCancelled(task.id);
    } catch {
      setLoading(null);
    }
  }

  async function handleRunNow() {
    setLoading("run");
    try {
      await api.queue.runNow(task.id);
      onStarted(task.id);
    } catch {
      setLoading(null);
    }
  }

  return (
    <Box my={6} style={{ display: "flex", justifyContent: "flex-start" }}>
      <Box
        style={{
          maxWidth: "75%",
          minWidth: 200,
          borderRadius: 12,
          borderTopLeftRadius: 4,
          border: `1.5px dashed var(--mantine-color-${isRunning ? "blue" : "orange"}-5)`,
          background: `var(--mantine-color-${isRunning ? "blue" : "orange"}-light)`,
          padding: "8px 12px",
        }}
      >
        {/* Header row */}
        <Group gap={6} mb={5} wrap="nowrap">
          {isRunning ? (
            <Loader size={12} color="blue" />
          ) : isScheduled ? (
            <IconClockPlay size={14} color={`var(--mantine-color-orange-6)`} />
          ) : (
            <IconClock size={14} color={`var(--mantine-color-orange-6)`} />
          )}

          <Badge size="xs" color={isRunning ? "blue" : "orange"} variant="light" style={{ flexShrink: 0 }}>
            {isRunning ? "Выполняется" : isScheduled ? "Запланировано" : "Ожидает запуска"}
          </Badge>

          <Text size="xs" c="dimmed" style={{ marginLeft: "auto", flexShrink: 0 }}>
            {new Date(task.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </Group>

        {/* Prompt */}
        <Text
          size="sm"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: 0.85 }}
          mb={4}
        >
          {task.prompt || "Continue"}
        </Text>
        {task.model && (
          <Text size="xs" c="dimmed" mb={resumeAt || isPending ? 6 : 0}>
            Модель: {task.model.replace("claude-", "").replace(/-\d{8}$/, "")}
          </Text>
        )}

        {/* Scheduled time */}
        {resumeAt && (
          <Group gap={4} mb={isPending ? 6 : 0}>
            <IconClock size={11} color="var(--mantine-color-dimmed)" />
            <Text size="xs" c="dimmed">
              Старт:{" "}
              {resumeAt.toLocaleString("ru-RU", {
                day: "numeric", month: "short",
                hour: "2-digit", minute: "2-digit",
              })}
            </Text>
          </Group>
        )}

        {/* Actions (pending only) */}
        {isPending && (
          <Group gap={6}>
            <Tooltip label="Запустить сейчас" position="bottom" withArrow>
              <ActionIcon
                size="xs"
                variant="light"
                color="green"
                loading={loading === "run"}
                disabled={loading !== null}
                onClick={handleRunNow}
              >
                <IconPlayerPlay size={11} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Отменить задачу" position="bottom" withArrow>
              <ActionIcon
                size="xs"
                variant="light"
                color="red"
                loading={loading === "cancel"}
                disabled={loading !== null}
                onClick={handleCancel}
              >
                <IconX size={11} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Box>
    </Box>
  );
}
