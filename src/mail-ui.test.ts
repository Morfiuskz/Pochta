// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { safeEmail, reply } from "./mail-ui";
import type { Message, Account } from "./types";
describe("Email isolation", () => {
  it("removes active content and every remote image by default", () => {
    const html = safeEmail(
      '<script>alert(1)</script><img src="https://tracker.test/x" onerror="alert(1)"><style>body{background:url(https://tracker.test)}</style><a href="javascript:alert(1)">link</a><iframe src="https://evil.test"></iframe><form action="https://evil.test"><input></form>',
    );
    expect(html).not.toContain("tracker.test");
    expect(html).not.toContain("evil.test");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script>");
    expect(html).toContain("img-src 'none'");
    expect(html).toContain("html,body{background:#1b1e2a;color-scheme:dark}");
  });
  it("only allows opted-in http images without referrer", () => {
    const html = safeEmail(
      '<img src="https://images.test/photo"><img src="data:image/svg+xml,bad">',
      true,
    );
    expect(html).toContain("https://images.test/photo");
    expect(html).not.toContain("data:image");
    expect(html).toContain('referrerpolicy="no-referrer"');
  });
});
it("reply-all respects Reply-To, removes own accounts and duplicates", () => {
  const m = {
    accountId: "a",
    replyTo: "Support <support@example.org>",
    senderEmail: "sender@example.org",
    sender: "Sender",
    to: "me@example.org, other@example.org",
    cc: "other@example.org, second@example.org, alt@example.org",
    subject: "Hello",
    text: "Original",
    date: 1,
    messageId: "<id@example.org>",
    references: "<old@example.org>",
  } as Message;
  const a = [
    { email: "me@example.org" },
    { email: "alt@example.org" },
  ] as Account[];
  const d = reply(m, a, true);
  expect(d.to).toBe("support@example.org, other@example.org");
  expect(d.cc).toBe("second@example.org");
  expect(d.subject).toBe("Re: Hello");
  expect(d.body).toContain("> Original");
  expect(d.references).toBe("<old@example.org> <id@example.org>");
});
