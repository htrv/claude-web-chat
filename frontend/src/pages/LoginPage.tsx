import { useState, useEffect } from "react";
import {
  Box, Center, Paper, Title, TextInput, PasswordInput,
  Button, Text, Stack, Alert, useMantineColorScheme,
  ActionIcon, Group, Loader,
} from "@mantine/core";
import { IconSun, IconMoon, IconDeviceDesktop, IconBrandTelegram, IconLock } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import ClaudeIcon from "../components/ClaudeIcon";

type Stage = "login" | "2fa" | "change-password";

export default function LoginPage() {
  const navigate = useNavigate();
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<Stage>("login");
  const [twoFaToken, setTwoFaToken] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("token")) navigate("/", { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (stage !== "2fa" || !twoFaToken) return;
    const iv = setInterval(async () => {
      try {
        const status = await api.poll2FA(twoFaToken);
        if (status.status === "approved" && status.access_token) {
          clearInterval(iv);
          localStorage.setItem("token", status.access_token);
          if (status.force_password_change) {
            setStage("change-password");
          } else {
            navigate("/", { replace: true });
          }
        } else if (status.status === "denied") {
          clearInterval(iv);
          setStage("login");
          setTwoFaToken(null);
          setError("Вход отклонён через Telegram");
        } else if (status.status === "expired") {
          clearInterval(iv);
          setStage("login");
          setTwoFaToken(null);
          setError("Время подтверждения истекло. Попробуйте снова.");
        }
      } catch {
        clearInterval(iv);
        setStage("login");
        setTwoFaToken(null);
        setError("Ошибка проверки статуса");
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [stage, twoFaToken, navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.login(username, password);
      if (res.requires_2fa && res.two_fa_token) {
        setTwoFaToken(res.two_fa_token);
        setStage("2fa");
      } else if (res.access_token) {
        localStorage.setItem("token", res.access_token);
        if (res.force_password_change) {
          setStage("change-password");
        } else {
          navigate("/", { replace: true });
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Пароль должен быть не менее 8 символов");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }
    setChangingPassword(true);
    try {
      await api.changePassword(newPassword);
      navigate("/", { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Ошибка смены пароля");
    } finally {
      setChangingPassword(false);
    }
  }

  const themeIcons = [
    { value: "light", icon: <IconSun size={16} /> },
    { value: "dark", icon: <IconMoon size={16} /> },
    { value: "auto", icon: <IconDeviceDesktop size={16} /> },
  ] as const;

  return (
    <Box style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Group justify="flex-end" p="md">
        <Group gap={4}>
          {themeIcons.map(({ value, icon }) => (
            <ActionIcon
              key={value}
              variant={colorScheme === value ? "filled" : "subtle"}
              onClick={() => setColorScheme(value)}
              size="sm"
            >
              {icon}
            </ActionIcon>
          ))}
        </Group>
      </Group>

      <Center style={{ flex: 1 }}>
        <Paper w={380} p="xl" radius="lg" withBorder shadow="md">
          <Stack gap="lg">
            <Stack gap={8} align="center">
              <ClaudeIcon size={56} />
              <Title order={2} fw={600}>Claude Code</Title>
              <Text c="dimmed" size="sm">
                {stage === "change-password" ? "Смените пароль для продолжения" : "Войдите в аккаунт"}
              </Text>
            </Stack>

            {stage === "2fa" && (
              <Stack align="center" gap="md">
                <IconBrandTelegram size={48} color="#7c3aed" />
                <Text ta="center" fw={500}>Подтвердите вход в Telegram</Text>
                <Text size="sm" c="dimmed" ta="center">
                  Проверьте Telegram — там появилось сообщение с кнопками подтверждения.
                </Text>
                <Loader size="sm" />
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => { setStage("login"); setTwoFaToken(null); }}
                >
                  Отмена
                </Button>
              </Stack>
            )}

            {stage === "change-password" && (
              <form onSubmit={handleChangePassword}>
                <Stack gap="sm">
                  <Stack gap={4} align="center">
                    <IconLock size={32} color="#f59e0b" />
                    <Text size="sm" c="dimmed" ta="center">
                      Установлен временный пароль. Задайте новый перед входом.
                    </Text>
                  </Stack>
                  {error && <Alert color="red" radius="md">{error}</Alert>}
                  <PasswordInput
                    label="Новый пароль"
                    placeholder="Минимум 8 символов"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoFocus
                  />
                  <PasswordInput
                    label="Повторите пароль"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <Button type="submit" loading={changingPassword} fullWidth mt="xs">
                    Сохранить и войти
                  </Button>
                </Stack>
              </form>
            )}

            {stage === "login" && (
              <form onSubmit={handleLogin}>
                <Stack gap="sm">
                  {error && <Alert color="red" radius="md">{error}</Alert>}
                  <TextInput
                    label="Логин"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                  />
                  <PasswordInput
                    label="Пароль"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Button type="submit" loading={loading} fullWidth mt="xs">
                    Войти
                  </Button>
                </Stack>
              </form>
            )}
          </Stack>
        </Paper>
      </Center>
    </Box>
  );
}
