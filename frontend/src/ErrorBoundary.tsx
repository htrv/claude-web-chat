import { Component, type ErrorInfo, type ReactNode } from "react";
import { Box, Text, Button, Stack, Code } from "@mantine/core";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("React crash:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Box p="xl" style={{ maxWidth: 700, margin: "40px auto" }}>
        <Stack>
          <Text fw={700} size="lg" c="red">Произошла ошибка в интерфейсе</Text>
          <Code block style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {error.message}{"\n\n"}{error.stack}
          </Code>
          <Button onClick={() => this.setState({ error: null })} variant="light">
            Попробовать снова
          </Button>
        </Stack>
      </Box>
    );
  }
}
