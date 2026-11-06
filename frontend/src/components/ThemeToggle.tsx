import { Group, ActionIcon, Tooltip } from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import { IconSun, IconMoon, IconDeviceDesktop } from "@tabler/icons-react";

export default function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <Group gap={4}>
      <Tooltip label="Светлая">
        <ActionIcon
          variant={colorScheme === "light" ? "filled" : "subtle"}
          size="sm"
          onClick={() => setColorScheme("light")}
        >
          <IconSun size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Тёмная">
        <ActionIcon
          variant={colorScheme === "dark" ? "filled" : "subtle"}
          size="sm"
          onClick={() => setColorScheme("dark")}
        >
          <IconMoon size={14} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Авто">
        <ActionIcon
          variant={colorScheme === "auto" ? "filled" : "subtle"}
          size="sm"
          onClick={() => setColorScheme("auto")}
        >
          <IconDeviceDesktop size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
