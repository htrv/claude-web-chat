import { useState, useRef, useCallback } from "react";
import {
  Group, Textarea, ActionIcon, Box, Text, Paper, CloseButton, UnstyledButton, Tooltip, Popover, Tabs,
} from "@mantine/core";
import { IconSend, IconPaperclip, IconPlayerStop, IconCurrentLocation, IconSparkles, IconCheck, IconBolt, IconBrain, IconCrown } from "@tabler/icons-react";

const SKILLS: { name: string; description: string }[] = [
  { name: "init", description: "Инициализировать CLAUDE.md с документацией проекта" },
  { name: "review", description: "Ревью pull request" },
  { name: "security-review", description: "Полный security-ревью изменений в ветке" },
  { name: "simplify", description: "Ревью кода на качество, переиспользование и эффективность" },
  { name: "claude-api", description: "Помощь с Claude API / Anthropic SDK" },
  { name: "schedule", description: "Создать/управлять расписанием фоновых агентов" },
  { name: "loop", description: "Запустить команду с периодическим повтором" },
  { name: "update-config", description: "Настроить Claude Code через settings.json" },
  { name: "fewer-permission-prompts", description: "Сократить запросы разрешений, добавив allowlist" },
  { name: "vpn-status", description: "Показать статус VPN" },
  { name: "vpn-disconnect", description: "Отключиться от VPN" },
  { name: "vpn-connect", description: "Подключиться к VPN" },
  { name: "usage", description: "Показать статистику использования токенов" },
  { name: "help", description: "Справка по командам Claude Code" },
  { name: "compact", description: "Сжать историю разговора" },
  { name: "memory", description: "Управление памятью" },
  { name: "status", description: "Показать статус аккаунта" },
  { name: "config", description: "Открыть настройки" },
];

function getSlashFilter(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const afterSlash = text.slice(1);
  if (afterSlash.includes(" ")) return null;
  return afterSlash;
}

function getModelIcon(model: string | undefined, size = 15) {
  if (model?.includes("haiku")) return <IconBolt size={size} />;
  if (model?.includes("opus")) return <IconBrain size={size} />;
  if (model?.includes("fable")) return <IconCrown size={size} />;
  return <IconSparkles size={size} />;
}

function getModelColor(model: string | undefined): string {
  if (model?.includes("haiku")) return "teal";
  if (model?.includes("opus")) return "orange";
  if (model?.includes("fable")) return "yellow";
  return "violet";
}

export interface ModelOption {
  value: string;
  label: string;
  description: string;
}

interface Props {
  onSend: (text: string, files?: File[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  streaming?: boolean;
  model?: string;
  models?: ModelOption[];
  availableModels?: ModelOption[];
  onChangeModel?: (model: string) => void;
}

export default function InputArea({ onSend, onStop, disabled, streaming, model, models, availableModels, onChangeModel }: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [menuIndex, setMenuIndex] = useState(0);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelTab, setModelTab] = useState<string | null>("available");
  const [geoActive, setGeoActive] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleGeo() {
    if (geoActive) {
      setGeoActive(false);
      setGeoCoords(null);
      return;
    }
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) });
        setGeoActive(true);
        setGeoLoading(false);
      },
      () => { setGeoLoading(false); },
      { timeout: 10000 }
    );
  }

  const slashFilter = getSlashFilter(text);
  const menuOpen = slashFilter !== null;
  const filteredSkills = menuOpen
    ? SKILLS.filter((s) => s.name.startsWith(slashFilter))
    : [];

  const submit = useCallback(() => {
    if ((!text.trim() && !files.length) || disabled) return;
    let finalText = text.trim();
    if (geoActive && geoCoords) {
      finalText += `\n\n[Местоположение: lat=${geoCoords.lat.toFixed(6)}, lon=${geoCoords.lon.toFixed(6)}, точность=${geoCoords.acc}м]`;
    }
    onSend(finalText, files.length ? files : undefined);
    setText("");
    setFiles([]);
  }, [text, files, disabled, onSend, geoActive, geoCoords]);

  function selectSkill(name: string) {
    setText("/" + name + " ");
    setMenuIndex(0);
  }

  function handleChange(value: string) {
    setText(value);
    setMenuIndex(0);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (menuOpen && filteredSkills.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMenuIndex((i) => Math.min(i + 1, filteredSkills.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMenuIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const skill = filteredSkills[menuIndex] ?? filteredSkills[0];
        if (skill) {
          selectSkill(skill.name);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setText("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) setFiles((prev) => [...prev, ...picked]);
    e.target.value = "";
  }

  function handlePaste(e: React.ClipboardEvent) {
    const imageItems = Array.from(e.clipboardData.items).filter(
      (item) => item.type.startsWith("image/")
    );
    if (imageItems.length === 0) return;
    const newFiles = imageItems
      .map((item) => {
        const blob = item.getAsFile();
        if (!blob) return null;
        const ext = item.type.split("/")[1]?.split(";")[0] || "png";
        return new File([blob], `clipboard-${Date.now()}.${ext}`, { type: item.type });
      })
      .filter((f): f is File => f !== null);
    if (newFiles.length) setFiles((prev) => [...prev, ...newFiles]);
  }

  const sendDisabled = !streaming && (disabled || (!text.trim() && !files.length));

  return (
    <Box
      p="md"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      {menuOpen && filteredSkills.length > 0 && (
        <Paper shadow="md" radius="md" withBorder mb="xs" style={{ overflow: "hidden" }}>
          {filteredSkills.map((skill, i) => (
            <UnstyledButton
              key={skill.name}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSkill(skill.name);
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                padding: "8px 12px",
                backgroundColor:
                  i === menuIndex
                    ? "var(--mantine-color-violet-light)"
                    : "transparent",
                cursor: "pointer",
              }}
            >
              <Text size="sm" fw={500}>/{skill.name}</Text>
              <Text size="xs" c="dimmed">{skill.description}</Text>
            </UnstyledButton>
          ))}
        </Paper>
      )}

      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {files.map((f, i) => (
            <Paper key={i} px="xs" py={4} radius="md" withBorder style={{ display: "flex", alignItems: "center", gap: 6, maxWidth: 220 }}>
              <IconPaperclip size={13} style={{ flexShrink: 0 }} />
              <Text size="xs" truncate style={{ flex: 1 }}>{f.name}</Text>
              <CloseButton size="xs" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} />
            </Paper>
          ))}
        </div>
      )}

      <input
        type="file"
        ref={fileRef}
        multiple
        style={{ display: "none" }}
        onChange={handleFile}
      />

      {/* Main input row */}
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        {/* Left column: model above geo above clip, pinned to bottom */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, justifyContent: "flex-end" }}>
          {((models && models.length > 0) || (availableModels && availableModels.length > 0)) && onChangeModel && (
            <Popover
              opened={modelMenuOpen}
              onClose={() => setModelMenuOpen(false)}
              onDismiss={() => setModelMenuOpen(false)}
              position="top-start"
              withArrow
              shadow="md"
              width={340}
            >
              <Popover.Target>
                <Tooltip
                  label={`Модель: ${(availableModels ?? models ?? []).find((m) => m.value === model)?.label ?? model ?? "не выбрана"}`}
                  withArrow
                  disabled={modelMenuOpen}
                >
                  <ActionIcon
                    variant={modelMenuOpen ? "filled" : "light"}
                    color={modelMenuOpen ? "violet" : getModelColor(model)}
                    size="sm"
                    onClick={() => setModelMenuOpen((o) => !o)}
                    disabled={disabled}
                  >
                    {getModelIcon(model)}
                  </ActionIcon>
                </Tooltip>
              </Popover.Target>
              <Popover.Dropdown p={4}>
                <Tabs value={modelTab} onChange={setModelTab} keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="available">Доступные</Tabs.Tab>
                    <Tabs.Tab value="current">Текущие</Tabs.Tab>
                  </Tabs.List>
                  {(["available", "current"] as const).map((tab) => (
                    <Tabs.Panel key={tab} value={tab} pt={4}>
                      {(tab === "available" ? (availableModels ?? models ?? []) : (models ?? [])).map((m) => {
                        const selected = m.value === model;
                        return (
                          <UnstyledButton
                            key={m.value}
                            onClick={() => {
                              onChangeModel(m.value);
                              setModelMenuOpen(false);
                            }}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "8px 8px",
                              borderRadius: 8,
                              backgroundColor: selected ? "var(--mantine-color-violet-light)" : "transparent",
                            }}
                          >
                            <Group gap={6} wrap="nowrap">
                              <Box style={{ color: `var(--mantine-color-${getModelColor(m.value)}-6)`, display: "flex", alignItems: "center" }}>
                                {getModelIcon(m.value, 14)}
                              </Box>
                              <Text size="sm" fw={500} style={{ flex: 1 }}>{m.label}</Text>
                              {selected && <IconCheck size={14} color="var(--mantine-color-violet-6)" />}
                            </Group>
                            <Text size="xs" c="dimmed" style={{ lineHeight: 1.4 }}>{m.description}</Text>
                          </UnstyledButton>
                        );
                      })}
                    </Tabs.Panel>
                  ))}
                </Tabs>
              </Popover.Dropdown>
            </Popover>
          )}
          {typeof navigator !== "undefined" && navigator.geolocation && (
            <Tooltip
              label={
                geoActive && geoCoords
                  ? `${geoCoords.lat.toFixed(4)}, ${geoCoords.lon.toFixed(4)} (±${geoCoords.acc}м)`
                  : "Добавить геолокацию"
              }
              withArrow
            >
              <ActionIcon
                variant={geoActive ? "filled" : "subtle"}
                color={geoActive ? "teal" : "gray"}
                size="sm"
                onClick={toggleGeo}
                loading={geoLoading}
                disabled={disabled}
              >
                <IconCurrentLocation size={15} />
              </ActionIcon>
            </Tooltip>
          )}
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
          >
            <IconPaperclip size={15} />
          </ActionIcon>
        </div>

        {/* Textarea */}
        <Textarea
          style={{ flex: 1 }}
          placeholder="Напишите сообщение... (/ — команды, Enter — отправить, Shift+Enter — новая строка)"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          autosize
          minRows={1}
          maxRows={8}
          disabled={disabled}
          radius="lg"
        />

        {/* Send/Stop — stretches to full textarea height */}
        <button
          onClick={streaming ? onStop : submit}
          disabled={sendDisabled}
          style={{
            alignSelf: "stretch",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 38,
            flexShrink: 0,
            border: "none",
            borderRadius: 8,
            padding: 0,
            cursor: sendDisabled ? "default" : "pointer",
            background: streaming
              ? "var(--mantine-color-red-6)"
              : "var(--mantine-color-violet-6)",
            color: "white",
            opacity: sendDisabled ? 0.45 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {streaming ? <IconPlayerStop size={18} /> : <IconSend size={18} />}
        </button>
      </div>
    </Box>
  );
}
