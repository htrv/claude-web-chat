const BASE = "/api";

function getToken() {
  return localStorage.getItem("token") ?? "";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    let detail = err.detail ?? "Request failed";
    // FastAPI validation errors (422): detail is an array of {loc, msg, type}
    if (Array.isArray(detail)) {
      detail = detail.map((e) => e?.msg ?? String(e)).join("; ");
    } else if (typeof detail === "object") {
      detail = JSON.stringify(detail);
    }
    throw new Error(detail);
  }
  return res.json();
}

export interface UserOut {
  id: number;
  username: string;
  role: string;
  model: string;
  is_active: boolean;
  force_password_change: boolean;
  created_at: string;
}

export interface LoginResponse {
  requires_2fa: boolean;
  two_fa_token?: string;
  access_token?: string;
  token_type: string;
  force_password_change: boolean;
}

export interface TwoFAStatus {
  status: string;
  access_token?: string;
  force_password_change: boolean;
}

export interface ChatOut {
  id: string;
  title: string;
  workspace: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceItem {
  path: string;
  name: string;
  root: string;
}

export interface MessageOut {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  thinking_content: string | null;
  file_path: string | null;
  created_at: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cost_usd?: number | null;
}

export interface QueueTaskOut {
  id: string;
  chat_id: string;
  user_id: number;
  prompt: string;
  model: string | null;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  claude_session_id: string | null;
  resume_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface QueueScheduleOut {
  chat_id: string;
  mode: "manual" | "auto" | "window";
  window_from: string | null;
  window_to: string | null;
}

export interface ActiveSession {
  session_id: string;
  chat_id: string;
  username: string;
  model: string;
  prompt_preview: string;
  status: "thinking" | "streaming";
  elapsed_sec: number;
}


export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  poll2FA: (token: string) =>
    request<TwoFAStatus>(`/auth/2fa/status/${token}`),

  changePassword: (newPassword: string) =>
    request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ new_password: newPassword }),
    }),

  me: () => request<UserOut>("/auth/me"),

  updateMe: (data: { model: string }) =>
    request<UserOut>("/auth/me", { method: "PATCH", body: JSON.stringify(data) }),

  models: () =>
    request<{
      models: string[];
      default: string;
      options: { value: string; label: string; description: string }[];
      available_options: { value: string; label: string; description: string }[];
    }>("/auth/models"),

  workspaces: () => request<WorkspaceItem[]>("/workspaces"),

  usage: () => request<{
    plan: string;
    five_hour: { utilization: number; resets_at: string } | null;
    seven_day: { utilization: number; resets_at: string } | null;
    extra_usage: { is_enabled: boolean; used_credits: number | null; monthly_limit: number | null; currency: string | null } | null;
    limits: Array<{
      kind: string;
      group: string;
      percent: number;
      severity: string;
      resets_at: string;
      scope: { model: { id: string | null; display_name: string }; surface: null } | null;
      is_active: boolean;
    }> | null;
  }>("/usage"),

  chats: {
    list: () => request<ChatOut[]>("/chats"),
    create: (title = "Новый чат", workspace?: string) =>
      request<ChatOut>("/chats", { method: "POST", body: JSON.stringify({ title, workspace }) }),
    rename: (id: string, title: string) =>
      request<ChatOut>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    setWorkspace: (id: string, workspace: string) =>
      request<ChatOut>(`/chats/${id}`, { method: "PATCH", body: JSON.stringify({ workspace }) }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/chats/${id}`, { method: "DELETE" }),
    stop: (id: string) =>
      request<{ ok: boolean }>(`/chats/${id}/stop`, { method: "POST" }),
    testLimit: (id: string) =>
      request<{ ok: boolean; resume_at: string }>(`/chats/${id}/test-limit`, { method: "POST" }),
    deleteMessage: (chatId: string, messageId: string) =>
      request<{ ok: boolean }>(`/chats/${chatId}/messages/${messageId}`, { method: "DELETE" }),
    messages: (id: string, params?: { limit?: number; before_id?: string; all?: boolean }) => {
      const qs = params
        ? "?" + new URLSearchParams(
            Object.fromEntries(
              Object.entries(params)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)])
            )
          )
        : "";
      return request<{ items: MessageOut[]; has_more: boolean }>(`/chats/${id}/messages${qs}`);
    },
  },

  admin: {
    users: () => request<UserOut[]>("/admin/users"),
    createUser: (data: { username: string; password: string; role: string; model: string }) =>
      request<UserOut>("/admin/users", { method: "POST", body: JSON.stringify(data) }),
    updateUser: (id: number, data: Partial<{ role: string; model: string; is_active: boolean; password: string }>) =>
      request<UserOut>(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    deleteUser: (id: number) =>
      request<{ ok: boolean }>(`/admin/users/${id}`, { method: "DELETE" }),
    models: () =>
      request<{
        models: string[];
        default: string;
        options: { value: string; label: string; description: string }[];
        available_options: { value: string; label: string; description: string }[];
      }>("/admin/models"),
    activeSessions: () => request<ActiveSession[]>("/active"),
    claudeAuth: () =>
      request<{ mode: "subscription" | "proxy"; active_proxy: string | null; proxies: { name: string; base_url: string }[] }>(
        "/admin/claude-auth"
      ),
    setClaudeAuth: (data: { mode: "subscription" | "proxy"; proxy?: string | null }) =>
      request<{ mode: string; active_proxy: string | null }>("/admin/claude-auth", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
  },

  queue: {
    tasks: (params?: { status?: string; chat_id?: string }) => {
      const qs = params
        ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]))
        : "";
      return request<QueueTaskOut[]>(`/queue/tasks${qs}`);
    },
    createTask: (data: { chat_id: string; prompt?: string; model?: string | null; claude_session_id?: string | null; resume_at?: string | null }) =>
      request<QueueTaskOut>("/queue/tasks", { method: "POST", body: JSON.stringify(data) }),
    deleteTask: (id: string) =>
      request<{ ok: boolean }>(`/queue/tasks/${id}`, { method: "DELETE" }),
    runNow: (id: string) =>
      request<{ ok: boolean }>(`/queue/tasks/${id}/run`, { method: "POST" }),
    cancelTask: (id: string) =>
      request<QueueTaskOut>(`/queue/tasks/${id}/cancel`, { method: "POST" }),
    getSchedule: (chatId: string) =>
      request<QueueScheduleOut>(`/queue/schedule/${chatId}`),
    updateSchedule: (chatId: string, data: { mode: string; window_from?: string | null; window_to?: string | null }) =>
      request<QueueScheduleOut>(`/queue/schedule/${chatId}`, { method: "PUT", body: JSON.stringify(data) }),
  },

  vpn: {
    status: () => request<{ returncode: number; stdout: string; stderr: string }>("/vpn/status"),
    connect: (suffix: string) =>
      request<{ returncode: number; stdout: string; stderr: string }>("/vpn/connect", {
        method: "POST",
        body: JSON.stringify({ suffix }),
      }),
    disconnect: () =>
      request<{ returncode: number; stdout: string; stderr: string }>("/vpn/disconnect", { method: "POST" }),
  },

  uploadFile: async (chatId: string, file: File, message: string): Promise<{ file_path: string; filename: string }> => {
    const form = new FormData();
    form.append("file", file);
    form.append("message", message);
    form.append("token", getToken());
    const res = await fetch(`${BASE}/chats/${chatId}/upload`, { method: "POST", body: form });
    if (!res.ok) throw new Error("Upload failed");
    return res.json();
  },
};
