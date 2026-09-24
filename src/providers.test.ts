import { describe, expect, it } from "vitest";
import {
  detectProvider,
  applyProvider,
  passwordAvailable,
  providers,
} from "./providers";
import type { Account } from "./types";
describe("provider discovery", () => {
  it("matches exact domains and aliases, never suffix guesses", () => {
    expect(detectProvider(" me@YANDEX.KZ ")?.id).toBe("yandex");
    expect(detectProvider("me@bk.ru")?.id).toBe("mail");
    expect(detectProvider("me@googlemail.com")?.id).toBe("google");
    expect(detectProvider("me@hotmail.com")?.id).toBe("microsoft");
    expect(detectProvider("me@yandex.ru.attacker.test")).toBeUndefined();
    expect(detectProvider("me@company.test")).toBeUndefined();
    expect(detectProvider("invalid")).toBeUndefined();
  });
  it("selects supported auth and preserves display metadata", () => {
    const p = providers[0];
    const a = applyProvider(
      {
        name: "Работа",
        email: "me@company.test",
        senderName: "Я",
        id: "existing",
      } as Account,
      p,
    );
    expect(a.imap.host).toBe("imap.yandex.com");
    expect(a.imap.login).toBe("me@company.test");
    expect(a.name).toBe("Работа");
    expect(a.id).toBe("existing");
    expect(p.oauthImplemented).toBe(true);
    expect(passwordAvailable(providers.find((p) => p.id === "microsoft"))).toBe(
      false,
    );
    expect(passwordAvailable(providers.find((p) => p.id === "google"))).toBe(
      true,
    );
  });
});
