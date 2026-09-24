import type { Account, Server } from "./types";
export interface Provider {
  id: string;
  name: string;
  domains: string[];
  imap: Omit<Server, "login">;
  smtp: Omit<Server, "login">;
  authMethods: ("password" | "oauth")[];
  oauthImplemented: boolean;
}
const provider = (
  id: string,
  name: string,
  domains: string[],
  imap: string,
  smtp: string,
  oauthImplemented = false,
  smtpPort = 465,
  authMethods: Provider["authMethods"] = ["oauth", "password"],
): Provider => ({
  id,
  name,
  domains,
  imap: { host: imap, port: 993, security: "tls" },
  smtp: {
    host: smtp,
    port: smtpPort,
    security: smtpPort === 465 ? "tls" : "starttls",
  },
  authMethods,
  oauthImplemented,
});
export const providers: Provider[] = [
  provider(
    "yandex",
    "Яндекс",
    [
      "yandex.ru",
      "ya.ru",
      "yandex.com",
      "yandex.kz",
      "yandex.by",
      "yandex.com.tr",
      "yandex.uz",
      "yandex.ua",
    ],
    "imap.yandex.com",
    "smtp.yandex.com",
    true,
  ),
  provider(
    "mail",
    "Mail",
    [
      "mail.ru",
      "inbox.ru",
      "list.ru",
      "bk.ru",
      "internet.ru",
      "mail.ua",
      "vk.com",
      "xmail.ru",
    ],
    "imap.mail.ru",
    "smtp.mail.ru",
    true,
  ),
  provider(
    "google",
    "Google",
    ["gmail.com", "googlemail.com"],
    "imap.gmail.com",
    "smtp.gmail.com",
    true,
  ),
  provider(
    "microsoft",
    "Outlook / Microsoft",
    ["outlook.com", "hotmail.com", "live.com", "msn.com", "outlook.ru"],
    "outlook.office365.com",
    "smtp-mail.outlook.com",
    false,
    587,
    ["oauth"],
  ),
  provider(
    "icloud",
    "iCloud",
    ["icloud.com", "me.com", "mac.com"],
    "imap.mail.me.com",
    "smtp.mail.me.com",
    false,
    587,
    ["password"],
  ),
];
export function detectProvider(email: string) {
  const domain = email.trim().toLowerCase().split("@");
  return domain.length === 2
    ? providers.find((p) => p.domains.includes(domain[1]))
    : undefined;
}
export function applyProvider(a: Account, p: Provider): Account {
  return {
    ...a,
    email: a.email.trim(),
    auth: { method: "password" },
    sameCredentials: true,
    imap: { ...p.imap, login: a.email.trim() },
    smtp: { ...p.smtp, login: a.email.trim() },
  };
}
export function passwordAvailable(p?: Provider) {
  return !p || p.authMethods.includes("password");
}
export function detectProviderFromServers(discovered: Discovered) {
  return providers.find(
    (p) =>
      p.imap.host === discovered.imap.host.toLowerCase() &&
      p.smtp.host === discovered.smtp.host.toLowerCase(),
  );
}
export interface Discovered {
  imap: Server;
  smtp: Server;
  name: string;
}
