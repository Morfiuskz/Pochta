import { useState } from "react";
import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";
import { api, errorText } from "./api";
import {
  applyProvider,
  detectProvider,
  detectProviderFromServers,
  passwordAvailable,
  providers,
  type Provider,
  type Discovered,
} from "./providers";
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
  const [step, setStep] = useState<"email" | "choice" | "manual">(
    account
      ? account.auth?.method === "oauth"
        ? "choice"
        : "manual"
      : "email",
  );
  const [provider, setProvider] = useState<Provider | undefined>(
    account?.auth?.method === "oauth"
      ? providers.find(
          (p) =>
            account.auth?.method === "oauth" && p.id === account.auth.provider,
        )
      : undefined,
  );
  const [configured, setConfigured] = useState(!!account);
  const [oauthInfo, setOauthInfo] = useState("");
  const [passwordMode, setPasswordMode] = useState(false);
  const [source, setSource] = useState("");
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
    setA((v) => ({
      ...v,
      email: value,
      imap: { ...v.imap, login: value },
      smtp: { ...v.smtp, login: value },
    }));
  }
  async function choose(p: Provider) {
    setProvider(p);
    setA((v) => applyProvider(v, p));
    setConfigured(true);
    setPasswordMode(false);
    setOauthInfo("");
    setSource("Настройки провайдера заполнены автоматически");
    if (p.oauthImplemented) {
      try {
        const status = await api<{ ready: boolean; message: string }>(
          "oauth_status",
          { provider: p.id },
        );
        setOauthInfo(status.message);
      } catch (e) {
        setOauthInfo(errorText(e));
      }
    }
  }
  async function discover() {
    setBusy(true);
    setNotice("");
    try {
      const p = detectProvider(a.email);
      if (p) {
        await choose(p);
      } else {
        setA((v) => ({
          ...v,
          imap: { ...blank.imap, login: v.email.trim() },
          smtp: { ...blank.smtp, login: v.email.trim() },
          sameCredentials: true,
          auth: { method: "password" },
        }));
        setPasswordMode(false);
        setProvider(undefined);
        setConfigured(false);
        setOauthInfo("");
        setSource("");
        const result = await api<Discovered | null>("discover_provider", {
          email: a.email.trim(),
        });
        if (result) {
          const discoveredProvider = detectProviderFromServers(result);
          if (discoveredProvider?.id === "google") {
            await choose(discoveredProvider);
            setSource(`Настройки из Thunderbird ISPDB: ${result.name}`);
            return;
          }
          setA((v) => ({
            ...v,
            email: v.email.trim(),
            imap: result.imap,
            smtp: result.smtp,
            sameCredentials: result.imap.login === result.smtp.login,
            auth: { method: "password" },
          }));
          setConfigured(true);
          setSource(`Настройки из Thunderbird ISPDB: ${result.name}`);
          setPasswordMode(true);
        }
      }
    } catch {
      setConfigured(false);
    } finally {
      setStep("choice");
      setBusy(false);
    }
  }
  async function oauthLogin() {
    if (!provider) return;
    setBusy(true);
    setNotice(
      "Ожидаем вход в браузере, затем проверим IMAP и SMTP. До 3 минут.",
    );
    setOk(false);
    try {
      const saved = await api<Account>("connect_oauth", {
        account: applyProvider(a, provider),
        provider: provider.id,
      });
      await onSaved(saved, sync);
      onClose();
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit(test: boolean) {
    setBusy(true);
    setNotice("");
    setOk(false);
    try {
      const input: AccountInput = {
        account: {
          ...a,
          email: a.email.trim(),
          name: a.name.trim() || a.email.trim(),
        },
        password,
        smtpPassword,
      };
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
  if (step !== "manual")
    return (
      <Modal
        title={account ? "Редактировать подключение" : "Добавить почту"}
        onClose={onClose}
        busy={busy}
        compact
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step === "email") void discover();
            else if (configured && passwordMode && passwordAvailable(provider))
              void submit(false);
          }}
        >
          <fieldset disabled={busy}>
            {step === "email" ? (
              <div className="onboarding-fields">
                <p className="muted">
                  Укажите почту — мы подберём способ подключения.
                </p>
                <label>
                  Email
                  <input
                    type="email"
                    required
                    value={a.email}
                    onChange={(e) => email(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </label>
                <label>
                  Название аккаунта <span className="muted">необязательно</span>
                  <input
                    value={a.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Например, Работа"
                  />
                </label>
                <p className="security-note">
                  Для неизвестного провайдера проверим его домен в Thunderbird
                  ISPDB. Адрес целиком и пароли не передаются.
                </p>
              </div>
            ) : (
              <div className="onboarding-fields">
                <div>
                  <strong>{a.name || a.email}</strong>
                  {a.name && <p className="muted">{a.email}</p>}
                </div>
                {!configured ? (
                  <>
                    <p>Не удалось определить настройки автоматически</p>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setStep("manual")}
                    >
                      Настроить вручную
                    </button>
                    <label>
                      Знаете своего провайдера?
                      <select
                        value=""
                        onChange={(e) => {
                          const p = providers.find(
                            (p) => p.id === e.target.value,
                          );
                          if (p) void choose(p);
                        }}
                      >
                        <option value="">
                          Выберите, в том числе для доменной почты
                        </option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.id === "yandex" ? " / Яндекс 360" : ""}
                            {p.id === "google" ? " / Gmail" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <>
                    <p className="muted">
                      {provider?.name} · {source || "Сохранённое подключение"}
                    </p>
                    {provider?.oauthImplemented && (
                      <>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => void oauthLogin()}
                        >
                          {account?.auth?.method === "oauth"
                            ? `Войти в ${provider.name} снова`
                            : `Войти через ${provider.name}`}
                        </button>
                        <p className="security-note">
                          {oauthInfo ||
                            "Вход в системном браузере. Пароль вводится только на сайте провайдера."}
                        </p>
                      </>
                    )}
                    {!passwordAvailable(provider) && (
                      <p className="form-warning">
                        Провайдер требует OAuth. Вход Microsoft в этой версии
                        ещё не реализован; пароль запрашивать не будем.
                      </p>
                    )}
                    {passwordAvailable(provider) && !passwordMode && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setPasswordMode(true);
                          setA((v) => ({ ...v, auth: { method: "password" } }));
                        }}
                      >
                        Использовать пароль приложения
                      </button>
                    )}
                    {passwordMode && (
                      <>
                        <p className="security-note">
                          Введите пароль приложения, созданный в настройках
                          почтового провайдера.
                        </p>
                        <label>
                          Пароль приложения
                          <input
                            type="password"
                            required={
                              !account || account.auth?.method === "oauth"
                            }
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="new-password"
                          />
                        </label>
                        {!a.sameCredentials && (
                          <label>
                            Пароль приложения SMTP
                            <input
                              type="password"
                              required={
                                !account || account.auth?.method === "oauth"
                              }
                              value={smtpPassword}
                              onChange={(e) => setSmtpPassword(e.target.value)}
                              autoComplete="new-password"
                            />
                          </label>
                        )}
                      </>
                    )}
                    <details>
                      <summary>Настройки подключения</summary>
                      <p>
                        IMAP: {a.imap.host}:{a.imap.port} · {a.imap.security}
                      </p>
                      <p>
                        SMTP: {a.smtp.host}:{a.smtp.port} · {a.smtp.security}
                      </p>
                    </details>
                    {a.auth?.method !== "oauth" && (
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => setStep("manual")}
                      >
                        Настроить вручную
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </fieldset>
          {notice && (
            <div role="status" className={`notice ${ok ? "success" : "error"}`}>
              {notice}
            </div>
          )}
          <footer>
            {step === "choice" && !account && (
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  setStep("email");
                  setPassword("");
                  setSmtpPassword("");
                  setNotice("");
                }}
              >
                Назад
              </button>
            )}
            <span className="spacer" />
            {busy && <LoaderCircle size={18} className="spin" />}
            {step === "email" ? (
              <button className="primary" disabled={busy}>
                Продолжить
              </button>
            ) : (
              configured &&
              passwordMode &&
              passwordAvailable(provider) && (
                <button className="primary" disabled={busy}>
                  Проверить и сохранить
                </button>
              )
            )}
          </footer>
        </form>
      </Modal>
    );
  return (
    <Modal
      title={account ? "Редактировать подключение" : "Добавить почту"}
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
                required={!account || account.auth?.method === "oauth"}
              />
            </label>
          </div>
          {(["imap", "smtp"] as const).map((kind) => (
            <section className="server-section" key={kind}>
              <h3>
                <span>{kind.toUpperCase()}</span>{" "}
                {kind === "imap" ? "Входящая почта" : "Исходящая почта"}
              </h3>
              {kind === "imap" && (
                <label>
                  Протокол
                  <select value="imap" disabled>
                    <option value="imap">IMAP — рекомендуется</option>
                    <option value="pop3" disabled>
                      POP3 — legacy, позже
                    </option>
                  </select>
                </label>
              )}
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
                      required={!account || account.auth?.method === "oauth"}
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
            onClick={(e) => {
              if (e.currentTarget.form?.reportValidity()) void submit(true);
            }}
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
            Проверить и сохранить
          </button>
        </footer>
      </form>
    </Modal>
  );
}
