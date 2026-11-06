import { useRef, useState } from "react";
import { Box, Text, Paper, Collapse, Modal, ActionIcon, Tooltip, Popover, Button, Group } from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { MessageOut } from "../lib/api";
import MermaidChart from "./MermaidChart";

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), 'alt', 'title', 'width', 'height'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https', 'data'],
  },
};

function getMermaidFromNode(node: unknown): string | null {
  const n = node as { children?: { type?: string; tagName?: string; properties?: { className?: string[] }; children?: { type?: string; value?: string }[] }[] } | undefined;
  const codeChild = n?.children?.[0];
  if (
    codeChild?.type === "element" &&
    codeChild?.tagName === "code" &&
    Array.isArray(codeChild?.properties?.className) &&
    codeChild.properties!.className!.includes("language-mermaid")
  ) {
    return (codeChild.children ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.value ?? "")
      .join("")
      .trim();
  }
  return null;
}

function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = () => {
    const text = preRef.current?.textContent ?? "";

    const finish = () => {
      notifications.show({
        message: "Код скопирован в буфер обмена",
        color: "violet",
        autoClose: 2000,
      });
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(finish);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      finish();
    }
  };

  return (
    <div className="code-block-wrapper">
      <button className="copy-btn" onClick={handleCopy}>
        Копировать
      </button>
      <pre ref={preRef} {...props}>
        {children}
      </pre>
    </div>
  );
}

function isImagePath(path: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif)$/i.test(path);
}

function uploadUrl(filePath: string): string {
  const basename = filePath.split("/").pop() ?? "";
  return `/api/uploads/${encodeURIComponent(basename)}`;
}

function parseFilePaths(filePath: string | null): string[] {
  if (!filePath) return [];
  if (filePath.startsWith("[")) {
    try { return JSON.parse(filePath); } catch {}
  }
  return [filePath];
}

function ClickableImage({ src, alt }: { src?: string; alt?: string }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState(false);
  if (!src) return null;
  if (error) return (
    <Text size="xs" c="dimmed" style={{ fontStyle: "italic" }}>
      🖼 {alt || src}
    </Text>
  );
  return (
    <>
      <img
        src={src}
        alt={alt ?? ""}
        style={{ maxWidth: "100%", borderRadius: 8, cursor: "zoom-in", display: "block", marginTop: 4, marginBottom: 4 }}
        onClick={() => setFullscreen(true)}
        onError={() => setError(true)}
      />
      <Modal
        opened={fullscreen}
        onClose={() => setFullscreen(false)}
        size="100%"
        title={alt || "Изображение"}
        styles={{
          body: { overflow: "auto", maxHeight: "calc(100vh - 120px)", display: "flex", justifyContent: "center", alignItems: "flex-start" },
          content: { maxWidth: "100vw" },
        }}
      >
        <img
          src={src}
          alt={alt ?? ""}
          style={{ maxWidth: "100%", objectFit: "contain" }}
        />
      </Modal>
    </>
  );
}

interface Props {
  message: MessageOut;
  isStreaming?: boolean;
  isThinking?: boolean;
  onDelete?: (id: string) => void;
}

function formatThinking(text: string): string {
  return text.replace(/([.!?])([А-ЯЁA-Z])/g, "$1\n$2");
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatUsage(message: MessageOut): string | null {
  if (message.cost_usd == null) return null;
  const inTok = message.input_tokens ?? 0;
  const outTok = message.output_tokens ?? 0;
  const cached = message.cache_read_input_tokens ?? 0;
  const parts = [`${inTok.toLocaleString()} in · ${outTok.toLocaleString()} out`];
  if (cached > 0) parts.push(`${cached.toLocaleString()} cached`);
  parts.push(`$${message.cost_usd.toFixed(4)}`);
  return parts.join(" · ");
}

export default function MessageBubble({ message, isStreaming, isThinking, onDelete }: Props) {
  const isUser = message.role === "user";
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Box
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        alignItems: "flex-end",
        gap: 4,
        marginBottom: 12,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isUser && onDelete && !isThinking && (
        <Popover opened={confirmOpen} onClose={() => setConfirmOpen(false)} position="top" withArrow shadow="md">
          <Popover.Target>
            <Tooltip label="Удалить сообщение" position="top" disabled={confirmOpen}>
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                style={{ opacity: hovered || confirmOpen ? 1 : 0, transition: "opacity 0.15s" }}
                onClick={() => setConfirmOpen(true)}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          <Popover.Dropdown>
            <Text size="sm" mb="xs">Удалить сообщение?</Text>
            <Group gap="xs">
              <Button size="xs" color="red" onClick={() => { setConfirmOpen(false); onDelete(message.id); }}>Удалить</Button>
              <Button size="xs" variant="subtle" onClick={() => setConfirmOpen(false)}>Отмена</Button>
            </Group>
          </Popover.Dropdown>
        </Popover>
      )}
      <Paper
        px="md"
        py="sm"
        radius="lg"
        style={{
          maxWidth: isUser ? "80%" : "100%",
          minWidth: 0,
          overflow: "hidden",
          background: isUser
            ? "var(--mantine-color-violet-6)"
            : "var(--mantine-color-default)",
          color: isUser ? "#fff" : "var(--mantine-color-text)",
          borderBottomRightRadius: isUser ? 4 : undefined,
          borderBottomLeftRadius: isUser ? undefined : 4,
        }}
      >
        {isThinking ? (
          <div className="thinking-dots">
            <span /><span /><span />
          </div>
        ) : (
          <>
            {parseFilePaths(message.file_path).map((fp, i) =>
              isImagePath(fp) ? (
                <ClickableImage key={i} src={uploadUrl(fp)} alt={fp.split("/").pop()} />
              ) : (
                <Text key={i} size="xs" mb={4} opacity={0.75}>
                  📎 {fp.split("/").pop()}
                </Text>
              )
            )}
            {isUser ? (
              <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {message.content}
              </Text>
            ) : (
              <>
                {message.thinking_content && (
                  <div className="thinking-block">
                    <button
                      className="thinking-toggle"
                      onClick={() => setThinkingOpen((o) => !o)}
                    >
                      {thinkingOpen
                        ? <IconChevronDown size={12} />
                        : <IconChevronRight size={12} />}
                      <span>Размышления</span>
                    </button>
                    <Collapse in={thinkingOpen}>
                      <pre className="thinking-text">{formatThinking(message.thinking_content)}</pre>
                    </Collapse>
                  </div>
                )}
                <div className={`markdown-body${isStreaming ? " typing-cursor" : ""}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[[rehypeSanitize, sanitizeSchema], rehypeHighlight]}
                    components={{
                      pre: ({ children, node, ...props }) => {
                        const mermaidCode = getMermaidFromNode(node);
                        if (mermaidCode) return <MermaidChart code={mermaidCode} />;
                        return <CodeBlock {...props}>{children}</CodeBlock>;
                      },
                      img: ({ src, alt }) => <ClickableImage src={src} alt={alt} />,
                      table: ({ children, ...props }) => (
                        <div className="table-scroll">
                          <table {...props}>{children}</table>
                        </div>
                      ),
                      a: ({ href, children, ...props }) => {
                        if (href?.startsWith("/api/files/download/")) {
                          return (
                            <a
                              href={href}
                              download
                              className="download-btn"
                              {...props}
                            >
                              {children}
                            </a>
                          );
                        }
                        return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
                      },
                    }}
                  >
                    {typeof message.content === "string" ? message.content : String(message.content ?? "")}
                  </ReactMarkdown>
                </div>
              </>
            )}
            <Text
              size="xs"
              style={{
                textAlign: "right",
                marginTop: 4,
                opacity: 0.45,
                userSelect: "none",
                color: isUser ? "rgba(255,255,255,0.7)" : undefined,
              }}
            >
              {!isUser && formatUsage(message) && `${formatUsage(message)} · `}
              {formatTime(message.created_at)}
            </Text>
          </>
        )}
      </Paper>
      {!isUser && onDelete && !isThinking && (
        <Popover opened={confirmOpen} onClose={() => setConfirmOpen(false)} position="top" withArrow shadow="md">
          <Popover.Target>
            <Tooltip label="Удалить сообщение" position="top" disabled={confirmOpen}>
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                style={{ opacity: hovered || confirmOpen ? 1 : 0, transition: "opacity 0.15s" }}
                onClick={() => setConfirmOpen(true)}
              >
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          <Popover.Dropdown>
            <Text size="sm" mb="xs">Удалить сообщение?</Text>
            <Group gap="xs">
              <Button size="xs" color="red" onClick={() => { setConfirmOpen(false); onDelete(message.id); }}>Удалить</Button>
              <Button size="xs" variant="subtle" onClick={() => setConfirmOpen(false)}>Отмена</Button>
            </Group>
          </Popover.Dropdown>
        </Popover>
      )}
    </Box>
  );
}
