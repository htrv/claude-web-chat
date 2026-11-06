import { useState } from "react";
import {
  Stack, Text, Button, ActionIcon, Group, ScrollArea,
  TextInput, Menu, NavLink, Box, Badge, Tooltip,
} from "@mantine/core";
import {
  IconPlus, IconDots, IconPencil, IconTrash, IconCheck, IconX,
  IconShield, IconLogout, IconListCheck,
} from "@tabler/icons-react";
import type { ChatOut, UserOut } from "../lib/api";
import ClaudeIcon from "./ClaudeIcon";

interface Props {
  chats: ChatOut[];
  activeChatId: string | null;
  processingChatIds: Set<string>;
  user: UserOut | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  onAdmin: () => void;
  onQueue: () => void;
}


export default function Sidebar({ chats, activeChatId, processingChatIds, user, onSelect, onNew, onRename, onDelete, onLogout, onAdmin, onQueue }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);

  function startEdit(chat: ChatOut) {
    setEditingId(chat.id);
    setEditTitle(chat.title);
  }

  function commitEdit(id: string) {
    if (editTitle.trim()) onRename(id, editTitle.trim());
    setEditingId(null);
  }

  return (
    <Stack h="100%" gap={0} style={{ overflow: "hidden" }}>
      <Box p="md" pb="xs">
        <Group gap={8} wrap="nowrap">
          <ClaudeIcon size={28} />
          <Text fw={700} size="lg" c="violet">Claude Code</Text>
        </Group>
      </Box>

      <Box px="md" pb="xs">
        <Button
          leftSection={<IconPlus size={16} />}
          variant="light"
          fullWidth
          onClick={onNew}
          radius="md"
        >
          Новый чат
        </Button>
      </Box>

      <ScrollArea style={{ flex: 1 }} px="xs">
        <Stack gap={2} py="xs">
          {chats.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="lg">Нет чатов</Text>
          )}
          {chats.map((chat) => {
            const isProcessing = processingChatIds.has(chat.id);
            const isActive = chat.id === activeChatId;
            const showMenu = isActive || chat.id === hoveredChatId;

            return (
              <Box key={chat.id}>
                {editingId === chat.id ? (
                  <Group gap={4} px="xs" py={4}>
                    <TextInput
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit(chat.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      size="xs"
                      style={{ flex: 1 }}
                      autoFocus
                    />
                    <ActionIcon size="sm" color="green" onClick={() => commitEdit(chat.id)}><IconCheck size={14} /></ActionIcon>
                    <ActionIcon size="sm" color="gray" onClick={() => setEditingId(null)}><IconX size={14} /></ActionIcon>
                  </Group>
                ) : (
                  <Group
                    gap={0}
                    wrap="nowrap"
                    onMouseEnter={() => setHoveredChatId(chat.id)}
                    onMouseLeave={() => setHoveredChatId(null)}
                  >
                    <Tooltip label={chat.title} position="right" openDelay={600} disabled={chat.title.length < 28} withArrow>
                      <NavLink
                        label={chat.title}
                        active={isActive}
                        onClick={() => onSelect(chat.id)}
                        style={{ flex: 1, minWidth: 0, borderRadius: 8 }}
                        styles={{ label: { fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }}
                      />
                    </Tooltip>

                    {/* Processing indicator — pulsing dot, shown instead of menu when streaming in background */}
                    {isProcessing && !isActive && (
                      <Box style={{ display: "flex", alignItems: "center", paddingRight: 6, flexShrink: 0 }}>
                        <span className="chat-processing-dot" />
                      </Box>
                    )}

                    <Box style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                      <Menu shadow="md" width={160} position="right-start">
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            style={{
                              opacity: showMenu ? 1 : 0,
                              pointerEvents: showMenu ? "auto" : "none",
                            }}
                            className="chat-menu-btn"
                          >
                            <IconDots size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => startEdit(chat)}>
                            Переименовать
                          </Menu.Item>
                          <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={() => onDelete(chat.id)}>
                            Удалить
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Box>
                  </Group>
                )}
              </Box>
            );
          })}
        </Stack>
      </ScrollArea>

      <Box p="md" pt="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Group gap={4} wrap="nowrap">
              <Text size="sm" fw={500} truncate>{user?.username ?? "..."}</Text>
              {user?.role === "admin" && <Badge size="xs" color="violet">admin</Badge>}
            </Group>
            <Text size="xs" c="dimmed" truncate>{user?.model ?? ""}</Text>
          </Stack>
          <Group gap={4}>
            <Tooltip label="Очередь задач">
              <ActionIcon variant="subtle" onClick={onQueue}><IconListCheck size={16} /></ActionIcon>
            </Tooltip>
            {user?.role === "admin" && (
              <Tooltip label="Админ панель">
                <ActionIcon variant="subtle" onClick={onAdmin}><IconShield size={16} /></ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Выйти">
              <ActionIcon variant="subtle" color="red" onClick={onLogout}><IconLogout size={16} /></ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>
    </Stack>
  );
}
