import { useState, useEffect, useRef } from "react";
import {
  Box, Group, Title, Button, Table, Badge, ActionIcon,
  Modal, TextInput, PasswordInput, Select, Stack, Text, Tabs,
  Switch, Tooltip, Loader, Center, Alert, Paper, Progress, SimpleGrid,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlus, IconEdit, IconTrash, IconArrowLeft, IconRefresh, IconActivity, IconWifi, IconWifiOff, IconReload, IconServer } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { UserOut, ActiveSession } from "../lib/api";
import ThemeToggle from "../components/ThemeToggle";
import { FALLBACK_MODELS, fetchModelOptions, fetchAvailableModelOptions, modelLabel, type ModelOption } from "../lib/models";

function ModelTabSelect({ label, current, available, value, onChange }: {
  label: string;
  current: ModelOption[];
  available: ModelOption[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{label}</Text>
      <Tabs defaultValue="available" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="available">Доступные</Tabs.Tab>
          <Tabs.Tab value="current">Текущие</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="available" pt="xs">
          <Select data={available} value={value} onChange={onChange} searchable />
        </Tabs.Panel>
        <Tabs.Panel value="current" pt="xs">
          <Select data={current} value={value} onChange={onChange} searchable />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editUser, setEditUser] = useState<UserOut | null>(null);
  const [createOpen, { open: openCreate, close: closeCreate }] = useDisclosure(false);
  const [editOpen, { open: openEdit, close: closeEdit }] = useDisclosure(false);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [newModel, setNewModel] = useState("claude-sonnet-4-6");
  const [editModel, setEditModel] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [vpnStatus, setVpnStatus] = useState<string | null>(null);
  const [vpnConnected, setVpnConnected] = useState<boolean | null>(null);
  const [vpnLoading, setVpnLoading] = useState(false);
  const [vpnToken, setVpnToken] = useState("");
  const [vpnOutput, setVpnOutput] = useState("");
  const [connectOpen, { open: openConnect, close: closeConnect }] = useDisclosure(false);

  const [claudeAuthMode, setClaudeAuthMode] = useState<"subscription" | "proxy" | null>(null);
  const [claudeActiveProxy, setClaudeActiveProxy] = useState<string | null>(null);
  const [claudeProxies, setClaudeProxies] = useState<{ name: string; base_url: string }[]>([]);
  const [claudeAuthSaving, setClaudeAuthSaving] = useState(false);

  type UsageData = {
    plan: string;
    five_hour: { utilization: number; resets_at: string } | null;
    seven_day: { utilization: number; resets_at: string } | null;
    extra_usage: { is_enabled: boolean; used_credits: number | null; monthly_limit: number | null; currency: string | null } | null;
    limits: Array<{ kind: string; percent: number; severity: string; resets_at: string; scope: { model: { id: string | null; display_name: string }; surface: null } | null; is_active: boolean }> | null;
  };
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  function timeUntil(iso: string): string {
    const delta = Math.max(0, new Date(iso).getTime() - Date.now());
    const d = Math.floor(delta / 86400000);
    const h = Math.floor((delta % 86400000) / 3600000);
    const m = Math.floor((delta % 3600000) / 60000);
    if (d > 0) return `${d}д ${h}ч`;
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
  }

  const USAGE_TTL = 10 * 60 * 1000;

  async function loadUsage(force = false) {
    const now = Date.now();
    const lastFetch = Number(localStorage.getItem("usage_last_fetch") ?? 0);
    const cached = localStorage.getItem("usage_cache");
    if (!force && cached && now - lastFetch < USAGE_TTL) {
      try { setUsageData(JSON.parse(cached)); } catch {}
      return;
    }
    setUsageLoading(true);
    try {
      const data = await api.usage();
      setUsageData(data);
      localStorage.setItem("usage_cache", JSON.stringify(data));
      localStorage.setItem("usage_last_fetch", String(Date.now()));
    } catch {
      if (cached) try { setUsageData(JSON.parse(cached)); } catch {}
    } finally {
      setUsageLoading(false);
    }
  }

  async function loadSessions() {
    try {
      setSessions(await api.admin.activeSessions());
    } catch {
      // не прерываем UI если нет активных
    }
  }

  async function loadVpnStatus() {
    try {
      const r = await api.vpn.status();
      setVpnStatus(r.stdout || r.stderr || "—");
      setVpnConnected(r.returncode === 0 && r.stdout.includes("CONN_CONNECTED"));
    } catch {
      setVpnStatus(null);
      setVpnConnected(null);
    }
  }

  async function handleVpnConnect() {
    setVpnLoading(true);
    setVpnOutput("");
    try {
      const r = await api.vpn.connect(vpnToken);
      setVpnOutput(r.stdout || r.stderr || "OK");
      await loadVpnStatus();
      if (r.returncode === 0) { setVpnToken(""); closeConnect(); }
    } catch (e: unknown) {
      setVpnOutput(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setVpnLoading(false);
    }
  }

  async function handleVpnDisconnect() {
    setVpnLoading(true);
    try {
      await api.vpn.disconnect();
      await loadVpnStatus();
    } catch {
      // ignore
    } finally {
      setVpnLoading(false);
    }
  }

  async function loadClaudeAuth() {
    try {
      const r = await api.admin.claudeAuth();
      setClaudeAuthMode(r.mode);
      setClaudeActiveProxy(r.active_proxy);
      setClaudeProxies(r.proxies);
    } catch {
      // ignore
    }
  }

  async function handleClaudeAuthChange(mode: "subscription" | "proxy", proxy: string | null) {
    setClaudeAuthSaving(true);
    try {
      const r = await api.admin.setClaudeAuth({ mode, proxy });
      setClaudeAuthMode(r.mode as "subscription" | "proxy");
      setClaudeActiveProxy(r.active_proxy);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка переключения");
      await loadClaudeAuth();
    } finally {
      setClaudeAuthSaving(false);
    }
  }

  useEffect(() => {
    loadUsers();
    loadSessions();
    loadVpnStatus();
    loadUsage();
    loadClaudeAuth();
    fetchModelOptions().then(setModels);
    fetchAvailableModelOptions().then(setAvailableModels);
    pollRef.current = setInterval(loadSessions, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      setUsers(await api.admin.users());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    setSaving(true);
    try {
      await api.admin.createUser({ username: newUsername, password: newPassword, role: newRole, model: newModel });
      setNewUsername(""); setNewPassword(""); setNewRole("user"); setNewModel("claude-sonnet-4-6");
      closeCreate();
      await loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка создания");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(u: UserOut) {
    setEditUser(u);
    setEditModel(u.model);
    setEditRole(u.role);
    setEditActive(u.is_active);
    setEditPassword("");
    openEdit();
  }

  async function handleSaveEdit() {
    if (!editUser) return;
    setSaving(true);
    try {
      await api.admin.updateUser(editUser.id, {
        role: editRole,
        model: editModel,
        is_active: editActive,
        ...(editPassword ? { password: editPassword } : {}),
      });
      closeEdit();
      await loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number, username: string) {
    if (!confirm(`Удалить пользователя ${username}?`)) return;
    try {
      await api.admin.deleteUser(id);
      await loadUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка удаления");
    }
  }

  return (
    <Box p="md" style={{ height: "100%", overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <Group justify="space-between" mb="lg">
        <Group>
          <ActionIcon variant="subtle" onClick={() => navigate("/")}>
            <IconArrowLeft size={18} />
          </ActionIcon>
          <Title order={3}>Админ панель</Title>
        </Group>
        <Group>
          <Text size="xs" c="dimmed">
            Фронт: {new Date(__BUILD_TIME__).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </Text>
          <Tooltip label="Перезагрузить страницу без кэша">
            <Button size="xs" variant="subtle" color="gray" onClick={() => { location.href = location.pathname + "?_cb=" + Date.now(); }}>
              Обновить фронт
            </Button>
          </Tooltip>
          <ThemeToggle />
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate} size="sm">
            Добавить пользователя
          </Button>
        </Group>
      </Group>

      {error && <Alert color="red" mb="md" withCloseButton onClose={() => setError("")}>{error}</Alert>}

      {/* Версия фронтенда */}
      <Paper withBorder radius="md" mb="lg" p="sm">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Фронтенд собран:{" "}
            <Text span fw={500} c="inherit">
              {new Date(__BUILD_TIME__).toLocaleString("ru", { timeZone: "Europe/Moscow" })}
            </Text>
          </Text>
          <Tooltip label="Перезагрузить без кеша">
            <Button
              size="xs"
              variant="light"
              leftSection={<IconReload size={14} />}
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("_cb", Date.now().toString());
                window.location.replace(url.toString());
              }}
            >
              Обновить фронт
            </Button>
          </Tooltip>
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }} mb="lg">
        {/* VPN */}
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              {vpnConnected ? <IconWifi size={18} color="var(--mantine-color-teal-6)" /> : <IconWifiOff size={18} color="var(--mantine-color-red-6)" />}
              <Text fw={500}>VPN</Text>
              {vpnConnected !== null && (
                <Badge color={vpnConnected ? "teal" : "red"} size="sm">
                  {vpnConnected ? "Подключён" : "Отключён"}
                </Badge>
              )}
            </Group>
            <Group gap="xs">
              <Tooltip label="Обновить статус">
                <ActionIcon variant="subtle" size="sm" onClick={loadVpnStatus}>
                  <IconRefresh size={15} />
                </ActionIcon>
              </Tooltip>
              {vpnConnected ? (
                <Button size="xs" color="red" variant="light" loading={vpnLoading} onClick={handleVpnDisconnect}>
                  Отключить
                </Button>
              ) : (
                <Button size="xs" color="teal" variant="light" onClick={openConnect}>
                  Подключить
                </Button>
              )}
            </Group>
          </Group>
          {vpnStatus && (
            <Text size="xs" c="dimmed" style={{ fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {vpnStatus}
            </Text>
          )}
        </Paper>

        {/* Usage */}
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <Text fw={500}>Usage</Text>
              {usageData && (
                <Badge variant="light" color="violet" size="sm">{usageData.plan}</Badge>
              )}
            </Group>
            <Tooltip label="Обновить">
              <ActionIcon variant="subtle" size="sm" onClick={() => loadUsage(true)} loading={usageLoading}>
                <IconRefresh size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
          {usageLoading && !usageData ? (
            <Center py="xs"><Loader size="xs" /></Center>
          ) : usageData ? (
            <Stack gap="xs">
              {usageData.five_hour && (
                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm">Session (5hr)</Text>
                    <Text size="sm" c="dimmed">{usageData.five_hour.utilization.toFixed(0)}%</Text>
                  </Group>
                  <Progress
                    value={usageData.five_hour.utilization}
                    color={usageData.five_hour.utilization > 80 ? "red" : usageData.five_hour.utilization > 50 ? "yellow" : "teal"}
                    size="sm" radius="sm"
                  />
                  <Text size="xs" c="dimmed" mt={3}>Resets in {timeUntil(usageData.five_hour.resets_at)}</Text>
                </Box>
              )}
              {usageData.seven_day && (
                <Box>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm">Weekly (7 day)</Text>
                    <Text size="sm" c="dimmed">{usageData.seven_day.utilization.toFixed(0)}%</Text>
                  </Group>
                  <Progress
                    value={usageData.seven_day.utilization}
                    color={usageData.seven_day.utilization > 80 ? "red" : usageData.seven_day.utilization > 50 ? "yellow" : "blue"}
                    size="sm" radius="sm"
                  />
                  <Text size="xs" c="dimmed" mt={3}>Resets in {timeUntil(usageData.seven_day.resets_at)}</Text>
                </Box>
              )}
              {usageData.limits?.filter((l) => l.scope !== null).map((l) => (
                <Box key={l.kind}>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm">{l.scope!.model.display_name} (неделя)</Text>
                    <Text size="sm" c="dimmed">{l.percent.toFixed(0)}%</Text>
                  </Group>
                  <Progress
                    value={l.percent}
                    color={l.percent > 80 ? "red" : l.percent > 50 ? "yellow" : "grape"}
                    size="sm" radius="sm"
                  />
                  <Text size="xs" c="dimmed" mt={3}>Resets in {timeUntil(l.resets_at)}</Text>
                </Box>
              ))}
              {usageData.extra_usage?.is_enabled && (
                <Box>
                  <Text size="sm" mb={2}>Extra usage</Text>
                  <Text size="xs" c="dimmed">
                    {usageData.extra_usage.used_credits ?? 0} / {usageData.extra_usage.monthly_limit ?? "∞"} {usageData.extra_usage.currency ?? "USD"}
                  </Text>
                </Box>
              )}
              {!usageData.five_hour && !usageData.seven_day && (
                <Text size="sm" c="dimmed">Нет данных</Text>
              )}
            </Stack>
          ) : (
            <Text size="sm" c="dimmed">Недоступно</Text>
          )}
        </Paper>
        {/* Claude auth: подписка vs прокси */}
        <Paper withBorder radius="md" p="md">
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <IconServer size={18} />
              <Text fw={500}>Источник авторизации Claude</Text>
              {claudeAuthMode && (
                <Badge color={claudeAuthMode === "proxy" ? "grape" : "teal"} size="sm">
                  {claudeAuthMode === "proxy" ? `Прокси: ${claudeActiveProxy}` : "Подписка"}
                </Badge>
              )}
            </Group>
            <Tooltip label="Обновить">
              <ActionIcon variant="subtle" size="sm" onClick={loadClaudeAuth}>
                <IconRefresh size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Stack gap="xs">
            <Group gap="xs">
              <Button
                size="xs"
                variant={claudeAuthMode === "subscription" ? "filled" : "light"}
                color="teal"
                loading={claudeAuthSaving && claudeAuthMode !== "subscription"}
                onClick={() => handleClaudeAuthChange("subscription", null)}
              >
                Подписка
              </Button>
              <Button
                size="xs"
                variant={claudeAuthMode === "proxy" ? "filled" : "light"}
                color="grape"
                disabled={claudeProxies.length === 0}
                loading={claudeAuthSaving && claudeAuthMode !== "proxy"}
                onClick={() => handleClaudeAuthChange("proxy", claudeActiveProxy ?? claudeProxies[0]?.name ?? null)}
              >
                Прокси
              </Button>
            </Group>
            {claudeProxies.length === 0 ? (
              <Text size="xs" c="dimmed">
                Прокси не заданы — добавьте их в CLAUDE_PROXIES в .env.
              </Text>
            ) : (
              <Select
                size="xs"
                placeholder="Выберите прокси"
                data={claudeProxies.map((p) => ({ value: p.name, label: `${p.name} (${p.base_url})` }))}
                value={claudeActiveProxy}
                disabled={claudeAuthMode !== "proxy"}
                onChange={(v) => v && handleClaudeAuthChange("proxy", v)}
              />
            )}
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* Активные запросы */}
      <Paper withBorder radius="md" mb="lg" p="md">
        <Group justify="space-between" mb="sm">
          <Group gap="xs">
            <IconActivity size={18} />
            <Text fw={500}>Активные запросы</Text>
            {sessions.length > 0 && (
              <Badge color="orange" size="sm">{sessions.length}</Badge>
            )}
          </Group>
          <Tooltip label="Обновить">
            <ActionIcon variant="subtle" onClick={loadSessions} size="sm">
              <IconRefresh size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {sessions.length === 0 ? (
          <Text size="sm" c="dimmed">Нет активных запросов</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Пользователь</Table.Th>
                <Table.Th>Модель</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Время</Table.Th>
                <Table.Th>Запрос</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sessions.map((s) => (
                <Table.Tr key={s.session_id}>
                  <Table.Td><Text size="sm" fw={500}>{s.username}</Text></Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{modelLabel(models, s.model)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={s.status === "streaming" ? "green" : "yellow"}
                      size="sm"
                    >
                      {s.status === "streaming" ? "Стриминг" : "Думает"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{s.elapsed_sec}с</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.prompt_preview || "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <Text fw={500} mb="sm">Пользователи</Text>

      {loading ? (
        <Center py="xl"><Loader /></Center>
      ) : (
        <Paper withBorder radius="md" style={{ overflowX: "auto" }}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Пользователь</Table.Th>
                <Table.Th>Роль</Table.Th>
                <Table.Th>Модель</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Зарегистрирован</Table.Th>
                <Table.Th></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.map((u) => (
                <Table.Tr key={u.id}>
                  <Table.Td><Text fw={500}>{u.username}</Text></Table.Td>
                  <Table.Td>
                    <Badge color={u.role === "admin" ? "violet" : "blue"} size="sm">{u.role}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{modelLabel(models, u.model)}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={u.is_active ? "green" : "red"} size="sm">
                      {u.is_active ? "Активен" : "Отключён"}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">{new Date(u.created_at).toLocaleDateString("ru")}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Tooltip label="Редактировать">
                        <ActionIcon variant="subtle" onClick={() => startEdit(u)}>
                          <IconEdit size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Удалить">
                        <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(u.id, u.username)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      <Modal opened={createOpen} onClose={closeCreate} title="Новый пользователь" centered>
        <Stack gap="sm">
          <TextInput label="Логин" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          <PasswordInput label="Пароль" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <Select label="Роль" data={[{ value: "user", label: "User" }, { value: "admin", label: "Admin" }]}
            value={newRole} onChange={(v) => setNewRole(v ?? "user")} />
          <ModelTabSelect label="Модель" current={models} available={availableModels}
            value={newModel} onChange={(v) => setNewModel(v ?? "claude-sonnet-4-6")} />
          <Button onClick={handleCreate} loading={saving} mt="xs">Создать</Button>
        </Stack>
      </Modal>

      <Modal opened={connectOpen} onClose={closeConnect} title="Подключить VPN" centered>
        <Stack gap="sm">
          <TextInput
            label="OTP токен"
            placeholder="Одноразовый токен"
            value={vpnToken}
            onChange={(e) => setVpnToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleVpnConnect()}
            autoFocus
          />
          {vpnOutput && (
            <Text size="xs" c="dimmed" style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
              {vpnOutput}
            </Text>
          )}
          <Button onClick={handleVpnConnect} loading={vpnLoading} color="teal">
            Подключить
          </Button>
        </Stack>
      </Modal>

      <Modal opened={editOpen} onClose={closeEdit} title={`Редактировать: ${editUser?.username}`} centered>
        <Stack gap="sm">
          <Select label="Роль" data={[{ value: "user", label: "User" }, { value: "admin", label: "Admin" }]}
            value={editRole} onChange={(v) => setEditRole(v ?? "user")} />
          <ModelTabSelect label="Модель" current={models} available={availableModels}
            value={editModel} onChange={(v) => setEditModel(v ?? "claude-sonnet-4-6")} />
          <Switch label="Активен" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} />
          <PasswordInput label="Новый пароль (оставьте пустым)" value={editPassword}
            onChange={(e) => setEditPassword(e.target.value)} />
          <Button onClick={handleSaveEdit} loading={saving} mt="xs">Сохранить</Button>
        </Stack>
      </Modal>
    </Box>
  );
}
