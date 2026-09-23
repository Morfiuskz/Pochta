import DOMPurify from "dompurify";
import type { Account, Compose, Message } from "./types";
export function safeEmail(html: string, images = false) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "div",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "blockquote",
      "pre",
      "code",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "td",
      "th",
      "hr",
      "img",
      "a",
    ],
    ALLOWED_ATTR: [
      "src",
      "alt",
      "width",
      "height",
      "colspan",
      "rowspan",
      "title",
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!images || !/^https?:\/\//i.test(src)) img.removeAttribute("src");
    img.setAttribute("referrerpolicy", "no-referrer");
  });
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${images ? "https: http:" : "'none'"}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><style>body{color:#d0d3e0;font:15px/1.8 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:6px 0;overflow-wrap:anywhere}h1,h2,h3{color:#eef0fa;line-height:1.4}a{color:#9998ff}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}td,th{padding:6px}blockquote{border-left:2px solid #555676;margin-left:0;padding-left:18px;color:#969aae}pre{white-space:pre-wrap}hr{border:0;border-top:1px solid #303342}</style></head><body>${doc.body.innerHTML}</body></html>`;
}
export function recipients(raw: string) {
  return raw.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+/gi) || [];
}
export function reply(m: Message, accounts: Account[], all = false): Compose {
  const own = new Set(accounts.map((a) => a.email.toLowerCase()));
  const primary = recipients(m.replyTo || m.senderEmail);
  const unique = (xs: string[]) => [
    ...new Set(
      xs.filter((x) => !own.has(x.toLowerCase())).map((x) => x.toLowerCase()),
    ),
  ];
  const to = unique([...primary, ...(all ? recipients(m.to) : [])]);
  const cc = all ? unique(recipients(m.cc)).filter((x) => !to.includes(x)) : [];
  return {
    id: crypto.randomUUID(),
    accountId: m.accountId,
    to: to.join(", "),
    cc: cc.join(", "),
    subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
    body: `\n\n${new Date(m.date * 1000).toLocaleString("ru-RU")}, ${m.sender} <${m.senderEmail}>:\n${m.text
      .split("\n")
      .map((s) => "> " + s)
      .join("\n")}`,
    attachments: [],
    inReplyTo: m.messageId,
    references: [m.references, m.messageId].filter(Boolean).join(" "),
  };
}
export const presets: Record<string, [string, string]> = {
  "gmail.com": ["imap.gmail.com", "smtp.gmail.com"],
  "yandex.ru": ["imap.yandex.ru", "smtp.yandex.ru"],
  "ya.ru": ["imap.yandex.ru", "smtp.yandex.ru"],
  "mail.ru": ["imap.mail.ru", "smtp.mail.ru"],
  "bk.ru": ["imap.mail.ru", "smtp.mail.ru"],
  "icloud.com": ["imap.mail.me.com", "smtp.mail.me.com"],
};
