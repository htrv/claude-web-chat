console.log("APP VERSION: v3");
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "highlight.js/styles/github-dark.css";
import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { theme } from "./theme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="bottom-right" autoClose={2000} />
        <App />
      </MantineProvider>
    </BrowserRouter>
  </StrictMode>
);
