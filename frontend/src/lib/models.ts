import { api } from "./api";

export interface ModelOption {
  value: string;
  label: string;
  description: string;
}

export const FALLBACK_MODELS: ModelOption[] = [
  { value: "claude-opus-4-8", label: "Opus 4.8 · максимум", description: "Самая мощная модель. Сложные задачи, большой контекст (1M)." },
  { value: "claude-opus-4-7", label: "Opus 4.7 · мощная", description: "Сложные задачи: архитектура, многошаговые рассуждения." },
  { value: "claude-sonnet-5", label: "Sonnet 5 · новая", description: "Новое поколение Sonnet. Баланс скорости и качества." },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6 · баланс", description: "Оптимально для большинства задач: код, анализ, разговор." },
  { value: "claude-haiku-4-5", label: "Haiku 4.5 · лёгкая", description: "Быстрые короткие ответы, простые вопросы." },
];

export const FALLBACK_AVAILABLE_MODELS: ModelOption[] = [
  ...FALLBACK_MODELS,
  { value: "claude-fable-5", label: "Fable 5 · творческая", description: "Модель поколения Claude 5, ориентированная на creative writing." },
];

export async function fetchModelOptions(): Promise<ModelOption[]> {
  try {
    const data = await api.models();
    return data.options?.length ? data.options : FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

// "Доступные" — расширенный список, включающий модели, проверенные вручную
// через CLI, но ещё не переведённые в основной каталог (см. models_catalog.py).
export async function fetchAvailableModelOptions(): Promise<ModelOption[]> {
  try {
    const data = await api.models();
    return data.available_options?.length ? data.available_options : FALLBACK_AVAILABLE_MODELS;
  } catch {
    return FALLBACK_AVAILABLE_MODELS;
  }
}

export function modelLabel(models: ModelOption[], value: string | undefined): string {
  if (!value) return "—";
  return models.find((m) => m.value === value)?.label ?? value;
}
