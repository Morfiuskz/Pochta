import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, Trash2, X, LoaderCircle } from "lucide-react";
import { Modal } from "./Modal";
import CustomDropdown from "./CustomDropdown";
import { api, errorText } from "./api";
import type { Account, Compose, Attachment } from "./types";
function hasContent(draft: Compose) {
  return Boolean(
    draft.to.trim() ||
    draft.cc.trim() ||
    draft.subject.trim() ||
    draft.body.trim() ||
    draft.attachments.length,
  );
}
export default function ComposeModal({
  initial,
  accounts,
  onClose,
  onSent,
}: {
  initial: Compose;
  accounts: Account[];
  onClose: () => void;
  onSent: (notice: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (busy || !hasContent(draft)) return;
    const timer = setTimeout(() => {
      void api("save_draft", { draft })
        .then(() => {
          if (active.current) setSaved(true);
        })
        .catch((e) => {
          if (active.current) setError(errorText(e));
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, busy]);
  const change = <K extends keyof Compose>(key: K, value: Compose[K]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  async function close() {
    try {
      if (hasContent(latest.current)) {
        await api("save_draft", { draft: latest.current });
      } else {
        await api("delete_draft", { id: latest.current.id });
      }
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function attach(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    try {
      if (
        [...files].reduce((n, f) => n + f.size, 0) +
          draft.attachments.reduce((n, f) => n + f.size, 0) >
        20 * 1024 * 1024
      )
        throw new Error("Общий размер вложений — не более 20 МБ");
      const items = await Promise.all(
        [...files].map(
          (f) =>
            new Promise<Attachment>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  name: f.name,
                  mime: f.type || "application/octet-stream",
                  size: f.size,
                  data: String(reader.result).split(",")[1],
                });
              reader.onerror = () =>
                reject(new Error("Не удалось прочитать файл"));
              reader.readAsDataURL(f);
            }),
        ),
      );
      change("attachments", [...draft.attachments, ...items]);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }
  async function send() {
    setBusy(true);
    setError("");
    try {
      await api("save_draft", { draft });
      const result = await api<string>("send_message", { draft });
      onSent(result);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  async function discard() {
    setBusy(true);
    try {
      await api("delete_draft", { id: draft.id });
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={draft.inReplyTo ? "Ответ на письмо" : "Новое письмо"}
      wide
      onClose={() => void close()}
      busy={busy}
    >
      <form
        className="compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <fieldset disabled={busy}>
          <div className="compose-row">
            <span>От кого</span>
            <CustomDropdown
              className="sender-dropdown"
              ariaLabel="Аккаунт отправителя"
              value={draft.accountId}
              onChange={(accountId) => change("accountId", accountId)}
              options={accounts
                .filter((a) => a.enabled)
                .map((a) => ({
                  value: a.id,
                  label: `${a.name} <${a.email}>`,
                }))}
            />
          </div>
          <label className="compose-row">
            <span>Кому</span>
            <input
              autoFocus
              required
              value={draft.to}
              onChange={(e) => change("to", e.target.value)}
              placeholder="email@example.com"
            />
          </label>
          <label className="compose-row">
            <span>Копия</span>
            <input
              value={draft.cc}
              onChange={(e) => change("cc", e.target.value)}
              placeholder="Необязательно"
            />
          </label>
          <label className="compose-row">
            <span>Тема</span>
            <input
              value={draft.subject}
              onChange={(e) => change("subject", e.target.value)}
              placeholder="Тема письма"
            />
          </label>
          <textarea
            aria-label="Текст письма"
            className="compose-body"
            placeholder="Напишите что-нибудь…"
            value={draft.body}
            onChange={(e) => change("body", e.target.value)}
          />
          <div className="compose-attachments">
            {draft.attachments.map((a, i) => (
              <span className="file-chip" key={i}>
                <Paperclip size={14} />
                {a.name}
                <button
                  type="button"
                  aria-label={`Убрать ${a.name}`}
                  onClick={() =>
                    change(
                      "attachments",
                      draft.attachments.filter((_, j) => i !== j),
                    )
                  }
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
          <input
            type="file"
            ref={file}
            hidden
            multiple
            onChange={(e) => void attach(e.target.files)}
          />
        </fieldset>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <footer>
          <button className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Send size={16} />
            )}
            Отправить
          </button>
          <button
            type="button"
            className="icon-button"
            title="Прикрепить файлы"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            <Paperclip size={19} />
          </button>
          <span className="draft-status">
            {saved ? "Черновик сохранён" : "Черновик"}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="icon-button"
            title="Удалить черновик"
            disabled={busy}
            onClick={() => void discard()}
          >
            <Trash2 size={18} />
          </button>
        </footer>
      </form>
    </Modal>
  );
}
