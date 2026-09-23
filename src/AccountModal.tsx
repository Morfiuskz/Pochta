import { useState } from "react";
import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";
import { api, errorText } from "./api";
import { presets } from "./mail-ui";
import type { Account, AccountInput, Server } from "./types";
const blank: Account = {
  id: "",
  name: "",
  senderName: "",
  email: "",
  imap: { host: "", port: 993, login: "", security: "tls" },
  smtp: { host: "", port: 465, login: "", security: "tls" },
  sameCredentials: true,
  isDefault: false,
  enabled: true,
};
export default function AccountModal({
  account,
  onClose,
  onSaved,
}: {
  account?: Account;
  onClose: () => void;
  onSaved: (a: Account, sync: boolean) => Promise<void>;
}) {
  const [a, setA] = useState<Account>(
    account ? structuredClone(account) : structuredClone(blank),
  );
  const [password, setPassword] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [sync, setSync] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [ok, setOk] = useState(false);
  const set = <K extends keyof Account>(key: K, value: Account[K]) => {
    setA((v) => ({ ...v, [key]: value }));
    setNotice("");
  };
  const server = (
    kind: "imap" | "smtp",
    key: keyof Server,
    value: string | number,
  ) =>
    setA((v) => ({
      ...v,
      [kind]: {
        ...v[kind],
        [key]: value,
        ...(key === "security"
          ? {
              port:
                kind === "imap"
                  ? value === "tls"
                    ? 993
                    : 143
                  : value === "tls"
                    ? 465
                    : 587,
            }
          : {}),
      },
    }));
  function email(value: string) {
    setA((v) => {
      const preset = presets[value.split("@")[1]?.toLowerCase()];
      return {
        ...v,
        email: value,
        imap: {
          ...v.imap,
          login: value,
          ...(!account && preset
            ? { host: preset[0], port: 993, security: "tls" as const }
            : {}),
        },
        smtp: {
          ...v.smtp,
          login: value,
          ...(!account && preset
            ? { host: preset[1], port: 465, security: "tls" as const }
            : {}),
        },
      };
    });
  }
  async function submit(test: boolean) {
    setBusy(true);
    setNotice("");
    setOk(false);
    try {
      const input: AccountInput = { account: a, password, smtpPassword };
      if (test) {
        setNotice(await api<string>("test_connection", { input }));
        setOk(true);
      } else {
        const saved = await api<Account>("save_account", { input });
        await onSaved(saved, sync);
        onClose();
      }
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={account ? "Редактировать подключение" : "Добавить аккаунт"}
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Название аккаунта
              <input
                value={a.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Например, Работа"
              />
            </label>
            <label>
              Имя отправителя
              <input
                value={a.senderName}
                onChange={(e) => set("senderName", e.target.value)}
                placeholder="Ваше имя"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                required
                value={a.email}
                onChange={(e) => email(e.target.value)}
                placeholder="you@example.com"
                autoComplete="off"
              />
            </label>
            <label>
              Пароль / app password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  account
                    ? "Оставьте пустым, чтобы сохранить"
                    : "Пароль приложения"
                }
                autoComplete="new-password"
                required={!account}
              />
            </label>
          </div>
          {(["imap", "smtp"] as const).map((kind) => (
            <section className="server-section" key={kind}>
              <h3>
                <span>{kind.toUpperCase()}</span>{" "}
                {kind === "imap" ? "Входящая почта" : "Исходящая почта"}
              </h3>
              {kind === "smtp" && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={a.sameCredentials}
                    onChange={(e) => set("sameCredentials", e.target.checked)}
                  />
                  Использовать те же данные, что и для IMAP
                </label>
              )}
              <div className="server-grid">
                <label>
                  Сервер
                  <input
                    required
                    placeholder={`${kind}.example.com`}
                    value={a[kind].host}
                    onChange={(e) => server(kind, "host", e.target.value)}
                  />
                </label>
                <label>
                  Порт
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    required
                    value={a[kind].port || ""}
                    onChange={(e) =>
                      server(kind, "port", Number(e.target.value))
                    }
                  />
                </label>
                <label>
                  Защита
                  <select
                    value={a[kind].security}
                    onChange={(e) => server(kind, "security", e.target.value)}
                  >
                    <option value="tls">SSL/TLS</option>
                    <option value="starttls">STARTTLS</option>
                    <option value="none">None</option>
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Логин
                  <input
                    disabled={kind === "smtp" && a.sameCredentials}
                    required
                    value={
                      kind === "smtp" && a.sameCredentials
                        ? a.imap.login
                        : a[kind].login
                    }
                    onChange={(e) => server(kind, "login", e.target.value)}
                  />
                </label>
                {kind === "smtp" && !a.sameCredentials && (
                  <label>
                    Пароль SMTP
                    <input
                      type="password"
                      required={!account}
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      placeholder={
                        account ? "Сохранённый пароль" : "Пароль SMTP"
                      }
                      autoComplete="new-password"
                    />
                  </label>
                )}
              </div>
            </section>
          ))}
          {(a.imap.security === "none" || a.smtp.security === "none") && (
            <p className="form-warning">
              None передаёт логин, пароль и почту без шифрования.
            </p>
          )}
          <div className="options">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={a.isDefault}
                onChange={(e) => set("isDefault", e.target.checked)}
              />
              Аккаунт по умолчанию для отправки
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={sync}
                onChange={(e) => setSync(e.target.checked)}
              />
              Синхронизировать после добавления
            </label>
          </div>
          <p className="security-note">
            <ShieldCheck size={15} /> Пароли сохраняются в защищённом хранилище
            системы
          </p>
        </fieldset>
        {notice && (
          <div role="status" className={`notice ${ok ? "success" : "error"}`}>
            {ok && <Check size={16} />} {notice}
          </div>
        )}
        <footer>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void submit(true)}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <ShieldCheck size={16} />
            )}
            Проверить подключение
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className="primary" disabled={busy}>
            Сохранить
          </button>
        </footer>
      </form>
    </Modal>
  );
}
