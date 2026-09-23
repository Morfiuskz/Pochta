import { invoke, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
export async function api<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop) {
    if (["list_accounts", "list_messages", "list_drafts"].includes(command))
      return [] as T;
    if (command === "get_ui") return "{}" as T;
    if (command === "save_ui") return undefined as T;
    throw new Error(
      "Подключение почты доступно в desktop-приложении. Запустите npm run tauri dev.",
    );
  }
  return invoke<T>(command, args);
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
