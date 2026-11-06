import { useEffect, useState, useRef } from "react";
import mermaid from "mermaid";
import { useMantineColorScheme, Modal, ActionIcon, Tooltip } from "@mantine/core";
import { IconMaximize } from "@tabler/icons-react";

mermaid.initialize({ startOnLoad: false });

let idCounter = 0;

export default function MermaidChart({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { colorScheme } = useMantineColorScheme();
  const idRef = useRef(`mermaid-${++idCounter}`);

  useEffect(() => {
    setSvg("");
    setError("");

    mermaid.initialize({
      startOnLoad: false,
      theme: colorScheme === "dark" ? "dark" : "default",
    });

    mermaid
      .render(idRef.current, code)
      .then(({ svg: rendered }) => setSvg(rendered))
      .catch((err: unknown) => {
        console.error("Mermaid render error:", err);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [code, colorScheme]);

  if (error) {
    return (
      <pre style={{ color: "red", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        [Mermaid error] {error}{"\n\n"}{code}
      </pre>
    );
  }

  if (!svg) return <div style={{ color: "gray", fontSize: 12 }}>Rendering diagram...</div>;

  return (
    <>
      <div
        style={{ position: "relative", overflowX: "auto", padding: "8px 0" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div dangerouslySetInnerHTML={{ __html: svg }} />
        {hovered && (
          <Tooltip label="На весь экран" position="top">
            <ActionIcon
              variant="light"
              size="sm"
              style={{ position: "absolute", top: 8, right: 8 }}
              onClick={() => setFullscreen(true)}
            >
              <IconMaximize size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </div>

      <Modal
        opened={fullscreen}
        onClose={() => setFullscreen(false)}
        size="100%"
        title="Диаграмма"
        styles={{
          body: { overflow: "auto", maxHeight: "calc(100vh - 120px)" },
          content: { maxWidth: "100vw" },
        }}
      >
        <div
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{ display: "flex", justifyContent: "center" }}
        />
      </Modal>
    </>
  );
}
