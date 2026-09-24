export type Security = "tls" | "starttls" | "none";
export interface Server {
  host: string;
  port: number;
  login: string;
  security: Security;
}
export interface Account {
  auth?: { method: "password" } | { method: "oauth"; provider: string };
  id: string;
  name: string;
  senderName: string;
  email: string;
  imap: Server;
  smtp: Server;
  sameCredentials: boolean;
  isDefault: boolean;
  enabled: boolean;
}
export interface AccountInput {
  account: Account;
  password: string;
  smtpPassword: string;
}
export interface Attachment {
  name: string;
  mime: string;
  size: number;
  data: string;
}
export interface Message {
  id: string;
  accountId: string;
  folder: string;
  kind: string;
  uid: number;
  uidValidity: number;
  sender: string;
  senderEmail: string;
  to: string;
  cc: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  date: number;
  read: boolean;
  starred: boolean;
  attachments: Attachment[];
  messageId: string;
  references: string;
}
export interface Summary extends Pick<
  Message,
  | "id"
  | "accountId"
  | "kind"
  | "sender"
  | "senderEmail"
  | "subject"
  | "date"
  | "read"
  | "starred"
> {
  snippet: string;
  hasAttachments: boolean;
}
export interface Compose {
  id: string;
  accountId: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  attachments: Attachment[];
  inReplyTo: string;
  references: string;
}
export interface Query {
  accountId: string;
  folder: string;
  filter: string;
  search: string;
}
