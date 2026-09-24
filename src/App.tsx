import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  LoaderCircle,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { Account, Compose, Message, Summary } from "./types";
import { api, desktop, errorText } from "./api";
import { reply, safeEmail } from "./mail-ui";
import AccountModal from "./AccountModal";
import ComposeModal from "./ComposeModal";
import { Modal } from "./Modal";
const navigation = [
  ["all", "Все письма", Mail],
  ["inbox", "Входящие", Inbox],
  ["starred", "Помеченные", Star],
  ["sent", "Отправленные", Send],
  ["drafts", "Черновики", FileText],
  ["spam", "Спам", Shield],
  ["trash", "Корзина", Trash2],
  ["archive", "Архив", Archive],
] as const;
interface SyncProgress {
  loaded: number;
  total: number | null;
}
type MessageSort = "newest" | "oldest" | "sender-asc" | "sender-desc";
const MESSAGE_SORT_OPTIONS: ReadonlyArray<{
  value: MessageSort;
  label: string;
}> = [
  { value: "newest", label: "Новые сначала" },
  { value: "oldest", label: "Старые сначала" },
  { value: "sender-asc", label: "Отправитель A–Z" },
  { value: "sender-desc", label: "Отправитель Z–A" },
];
interface ColumnWidths {
  sidebar: number;
  messageList: number;
}
const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { sidebar: 246, messageList: 359 };
const COLUMN_WIDTHS_KEY = "pochta.columnWidths";
const RESIZERS_WIDTH = 12;
const availableColumnWidth = () =>
  Math.max(window.innerWidth, 1040) - RESIZERS_WIDTH;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
const fitColumnWidths = (widths: ColumnWidths): ColumnWidths => {
  const available = availableColumnWidth();
  const sidebar = clamp(widths.sidebar, 190, Math.min(340, available - 680));
  const messageList = clamp(
    widths.messageList,
    300,
    Math.min(700, available - sidebar - 380),
  );
  return { sidebar, messageList };
};
const storedColumnWidths = () => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(COLUMN_WIDTHS_KEY) || "null",
    ) as Partial<ColumnWidths> | null;
    if (
      stored &&
      Number.isFinite(stored.sidebar) &&
      Number.isFinite(stored.messageList)
    ) {
      return fitColumnWidths({
        sidebar: stored.sidebar as number,
        messageList: stored.messageList as number,
      });
    }
  } catch {
    // Ignore damaged local UI preferences.
  }
  return fitColumnWidths(DEFAULT_COLUMN_WIDTHS);
};
const senderCollator = new Intl.Collator(["ru", "en"], {
  sensitivity: "base",
  numeric: true,
});
const senderLabel = (message: Summary) =>
  (message.sender.trim() || message.senderEmail.trim()).normalize("NFKC");
const dateLabel = (n: number) =>
  new Date(n * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
const initials = (s: string) =>
  s
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [messages, setMessages] = useState<Summary[]>([]);
  const [drafts, setDrafts] = useState<Compose[]>([]);
  const [accountId, setAccountId] = useState("");
  const [folder, setFolder] = useState("all");
  const [filter, setFilter] = useState("all");
  const [messageSort, setMessageSort] = useState<MessageSort>("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const [activeSortIndex, setActiveSortIndex] = useState(0);
  const [columnWidths, setColumnWidths] =
    useState<ColumnWidths>(storedColumnWidths);
  const [activeResizer, setActiveResizer] = useState<
    "sidebar" | "message-list" | null
  >(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Message | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [accountModal, setAccountModal] = useState<Account | "new" | null>(
    null,
  );
  const [compose, setCompose] = useState<Compose | null>(null);
  const [menu, setMenu] = useState("");
  const [rename, setRename] = useState<Account | null>(null);
  const [newName, setNewName] = useState("");
  const [remove, setRemove] = useState<Account | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncError, setSyncError] = useState("");
  const [acting, setActing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const [images, setImages] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sortControlRef = useRef<HTMLDivElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);
  const syncLock = useRef(false);
  const init = useRef(false);
  const request = useRef(0);
  const viewerRequest = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
    } catch {
      // Resizing still works when local preferences are unavailable.
    }
  }, [columnWidths]);
  useEffect(() => {
    const fitToWindow = () =>
      setColumnWidths((current) => fitColumnWidths(current));
    window.addEventListener("resize", fitToWindow);
    return () => window.removeEventListener("resize", fitToWindow);
  }, []);
  useEffect(() => {
    if (!sortOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!sortControlRef.current?.contains(event.target as Node)) {
        setSortOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSortOpen(false);
        sortButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [sortOpen]);
  const notify = useCallback(
    (text: string, error = false) => setNotice({ text, error }),
    [],
  );
  const openSort = () => {
    setActiveSortIndex(
      MESSAGE_SORT_OPTIONS.findIndex((option) => option.value === messageSort),
    );
    setSortOpen(true);
  };
  const chooseSort = (value: MessageSort) => {
    setMessageSort(value);
    setSortOpen(false);
    sortButtonRef.current?.focus();
  };
  const sortKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!sortOpen) {
        openSort();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveSortIndex(
        (current) =>
          (current + step + MESSAGE_SORT_OPTIONS.length) %
          MESSAGE_SORT_OPTIONS.length,
      );
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (sortOpen) {
        chooseSort(MESSAGE_SORT_OPTIONS[activeSortIndex].value);
      } else {
        openSort();
      }
    }
  };
  const startColumnResize = (
    target: "sidebar" | "message-list",
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidths = columnWidths;
    setActiveResizer(target);
    document.body.classList.add("resizing-columns");
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const available = availableColumnWidth();
      setColumnWidths(
        target === "sidebar"
          ? {
              ...startWidths,
              sidebar: clamp(
                startWidths.sidebar + delta,
                190,
                Math.min(340, available - startWidths.messageList - 380),
              ),
            }
          : {
              ...startWidths,
              messageList: clamp(
                startWidths.messageList + delta,
                300,
                Math.min(700, available - startWidths.sidebar - 380),
              ),
            },
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      document.body.classList.remove("resizing-columns");
      setActiveResizer(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
  };
  const loadAccounts = useCallback(async () => {
    const a = await api<Account[]>("list_accounts");
    setAccounts(a);
    return a;
  }, []);
  const load = useCallback(async () => {
    const n = ++request.current;
    const [ms, ds] = await Promise.all([
      api<Summary[]>("list_messages", {
        query: { accountId, folder, filter, search: query },
      }),
      api<Compose[]>("list_drafts"),
    ]);
    if (n === request.current) {
      setMessages(ms);
      setDrafts(ds);
    }
  }, [accountId, folder, filter, query]);
  const loadRef = useRef(load);
  loadRef.current = load;
  const sync = useCallback(
    async (items: Account[]) => {
      if (syncLock.current) return;
      syncLock.current = true;
      setSyncing(true);
      setSyncProgress(null);
      setSyncError("");
      const failures: string[] = [];
      let count = 0;
      for (const a of items.filter((a) => a.enabled)) {
        try {
          const onProgress = new Channel<SyncProgress>((progress) => {
            setSyncProgress(progress);
            void loadRef.current().catch((e) => notify(errorText(e), true));
          });
          await api("sync_account", { id: a.id, onProgress });
          count++;
        } catch (e) {
          failures.push(`${a.name}: ${errorText(e)}`);
        }
      }
      const current = selectedRef.current;
      if (current) {
        const token = viewerRequest.current;
        try {
          const refreshed = await api<Message>("get_message", {
            id: current.id,
          });
          if (token === viewerRequest.current) setSelected(refreshed);
        } catch {
          if (token === viewerRequest.current) {
            setSelected(null);
            setSelectedId("");
          }
        }
      }
      setSyncing(false);
      setSyncProgress(null);
      syncLock.current = false;
      if (count) setLastSync("Обновлено только что");
      if (failures.length) {
        const message = failures.join("\n");
        setSyncError(message);
        notify(message, true);
      }
    },
    [notify],
  );
  useEffect(() => {
    if (init.current) return;
    init.current = true;
    void (async () => {
      try {
        const [a, stored] = await Promise.all([
          loadAccounts(),
          api<string>("get_ui"),
        ]);
        const ui = JSON.parse(stored);
        if (navigation.some((n) => n[0] === ui.folder)) setFolder(ui.folder);
        if (a.some((x) => x.id === ui.accountId && x.enabled))
          setAccountId(ui.accountId);
        setInitialized(true);
        await sync(a);
      } catch (e) {
        notify(errorText(e), true);
        setInitialized(true);
      }
    })();
  }, [loadAccounts, sync, notify]);
  useEffect(() => {
    const id = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => {
    if (!initialized) return;
    void load().catch((e) => notify(errorText(e), true));
  }, [initialized, load, syncing, notify]);
  useEffect(() => {
    if (initialized)
      void api("save_ui", {
        value: JSON.stringify({ accountId, folder }),
      }).catch((e) => notify(errorText(e), true));
  }, [accountId, folder, initialized, notify]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setMenu("");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    setImages(false);
  }, [selectedId]);
  const html = useMemo(
    () => (selected?.html ? safeEmail(selected.html, images) : ""),
    [selected?.html, images],
  );
  async function choose(m: Summary) {
    const token = ++viewerRequest.current;
    setSelectedId(m.id);
    setLoading(true);
    setSelected(null);
    try {
      const full = await api<Message>("get_message", { id: m.id });
      if (token !== viewerRequest.current) return;
      setSelected(full);
      if (!full.read) {
        void api("message_action", { id: m.id, action: "read" })
          .then(() => {
            if (token === viewerRequest.current)
              setSelected((v) => (v ? { ...v, read: true } : v));
            void loadRef.current().catch((e) => notify(errorText(e), true));
          })
          .catch((e) => notify(errorText(e), true));
      }
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      if (token === viewerRequest.current) setLoading(false);
    }
  }
  function resetViewer() {
    viewerRequest.current++;
    setSelected(null);
    setSelectedId("");
    setLoading(false);
  }
  function navigate(f: string) {
    setFolder(f);
    setFilter("all");
    resetViewer();
  }
  async function action(kind: string) {
    if (!selected || acting) return;
    setActing(true);
    const token = viewerRequest.current;
    try {
      await api("message_action", { id: selected.id, action: kind });
      if (kind === "delete") {
        if (token === viewerRequest.current) resetViewer();
        notify("Письмо перемещено в корзину");
        void sync(accounts.filter((a) => a.id === selected.accountId));
      } else {
        const updated = await api<Message>("get_message", { id: selected.id });
        if (token === viewerRequest.current) setSelected(updated);
      }
      await loadRef.current();
    } catch (e) {
      notify(errorText(e), true);
    } finally {
      setActing(false);
    }
  }
  async function accountAction(a: Account, action: string, value?: string) {
    setMenu("");
    try {
      await api("account_action", { id: a.id, action, value });
      const updated = await loadAccounts();
      if (
        (accountId === a.id || selectedRef.current?.accountId === a.id) &&
        !updated.some((v) => v.id === a.id && v.enabled)
      ) {
        setAccountId("");
        resetViewer();
      }
      await loadRef.current();
      setRename(null);
      setRemove(null);
    } catch (e) {
      notify(errorText(e), true);
    }
  }
  function newCompose() {
    const a =
      accounts.find((a) => a.isDefault && a.enabled) ||
      accounts.find((a) => a.enabled);
    if (!a) {
      setAccountModal("new");
      return;
    }
    setCompose({
      id: crypto.randomUUID(),
      accountId: a.id,
      to: "",
      cc: "",
      subject: "",
      body: "",
      attachments: [],
      inReplyTo: "",
      references: "",
    });
  }
  const activeAccount = accounts.find((a) => a.id === accountId);
  const progressLabel = syncProgress
    ? syncProgress.total !== null
      ? `${syncProgress.loaded} / ${syncProgress.total}`
      : `Загружено ${syncProgress.loaded} писем`
    : "";
  const syncStatus = syncing
    ? `Синхронизация…${progressLabel ? ` ${progressLabel}` : ""}`
    : syncError
      ? `Ошибка синхронизации: ${syncError}`
      : lastSync || "Локальный кэш";
  const title = navigation.find((n) => n[0] === folder)?.[1] || "Все письма";
  const visibleDrafts = drafts.filter(
    (d) =>
      (!accountId || d.accountId === accountId) &&
      accounts.some((a) => a.id === d.accountId && a.enabled) &&
      (!query ||
        `${d.to} ${d.subject} ${d.body}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (filter !== "attachments" || d.attachments.length > 0) &&
      filter !== "unread",
  );
  const sortedMessages = useMemo(() => {
    const sorted = [...messages];
    sorted.sort((a, b) => {
      if (messageSort === "newest") return b.date - a.date;
      if (messageSort === "oldest") return a.date - b.date;
      const bySender = senderCollator.compare(senderLabel(a), senderLabel(b));
      if (bySender !== 0)
        return messageSort === "sender-asc" ? bySender : -bySender;
      return b.date - a.date;
    });
    return sorted;
  }, [messages, messageSort]);
  const index = sortedMessages.findIndex((m) => m.id === selectedId);
  return (
    <div className="app-shell">
      <aside className="sidebar" style={{ width: columnWidths.sidebar }}>
        <div className="brand">
          <div className="brand-icon">
            <Mail size={23} />
          </div>
          <div>
            <b>Почта</b>
            <span>ВАШЕ ЛИЧНОЕ ПРОСТРАНСТВО</span>
          </div>
        </div>
        <button className="compose-button" onClick={newCompose}>
          <PenLine size={18} />
          Написать письмо
          <Plus size={16} />
        </button>
        <span className="section-label">ПОЧТА</span>
        <nav>
          {navigation.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => {
                if (id === "all") setAccountId("");
                navigate(id);
              }}
              className={`nav-item ${folder === id ? "active" : ""}`}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === folder &&
                (messages.length > 0 ||
                  (id === "drafts" && visibleDrafts.length > 0)) && (
                  <small>
                    {messages.length +
                      (id === "drafts" ? visibleDrafts.length : 0)}
                  </small>
                )}
            </button>
          ))}
        </nav>
        <div className="accounts-heading">
          <span className="section-label">АККАУНТЫ</span>
          <button
            className="icon-button"
            title="Добавить аккаунт"
            onClick={() => setAccountModal("new")}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="account-list">
          {accounts.map((a, i) => (
            <div
              className={`account-row ${a.id === accountId ? "chosen" : ""} ${!a.enabled ? "disabled-account" : ""}`}
              key={a.id}
            >
              <button
                className="account-select"
                disabled={!a.enabled}
                onClick={() => {
                  setAccountId(a.id);
                  navigate("inbox");
                }}
              >
                <span className={`account-avatar color-${i % 4}`}>
                  {initials(a.name)}
                </span>
                <span className="account-copy">
                  <strong>
                    {a.name}
                    {a.isDefault && (
                      <span title="По умолчанию" className="default-dot" />
                    )}
                  </strong>
                  <small title={a.email}>{a.email}</small>
                  {!a.enabled && <small>Отключён</small>}
                </span>
              </button>
              <button
                className="icon-button account-more"
                aria-label={`Меню ${a.name}`}
                aria-expanded={menu === a.id}
                onClick={() => setMenu(menu === a.id ? "" : a.id)}
              >
                <MoreHorizontal size={17} />
              </button>
              {menu === a.id && (
                <>
                  <button
                    className="menu-backdrop"
                    aria-label="Закрыть меню"
                    onClick={() => setMenu("")}
                  />
                  <div
                    className="account-menu"
                    style={{ left: columnWidths.sidebar - 20 }}
                  >
                    <button
                      disabled={!a.enabled || syncing}
                      onClick={() => {
                        setMenu("");
                        void sync([a]);
                      }}
                    >
                      Синхронизировать
                    </button>
                    <button
                      disabled={!a.enabled}
                      onClick={() => void accountAction(a, "default")}
                    >
                      По умолчанию для отправки
                    </button>
                    <button
                      onClick={() => {
                        setMenu("");
                        setRename(a);
                        setNewName(a.name);
                      }}
                    >
                      Переименовать
                    </button>
                    <button
                      onClick={() => {
                        setMenu("");
                        setAccountModal(a);
                      }}
                    >
                      Редактировать подключение
                    </button>
                    <button onClick={() => void accountAction(a, "toggle")}>
                      {a.enabled ? "Отключить" : "Включить"}
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => {
                        setMenu("");
                        setRemove(a);
                      }}
                    >
                      Удалить аккаунт
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!accounts.length && (
            <button
              className="add-first"
              onClick={() => setAccountModal("new")}
            >
              <Plus size={18} />
              <span>
                Добавьте первый ящик<small>Вся почта в одном месте</small>
              </span>
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <ShieldCheck size={17} />
          <span>
            Только на вашем устройстве
            <small>
              <button
                className="author-link"
                onClick={() =>
                  void api("open_author_site").catch((error) =>
                    notify(errorText(error), true),
                  )
                }
              >
                Morfius
              </button>
              <span>v0.1.0</span>
            </small>
          </span>
        </div>
      </aside>
      <div
        className={`column-resizer ${activeResizer === "sidebar" ? "active" : ""}`}
        role="separator"
        aria-label="Изменить ширину боковой панели"
        aria-orientation="vertical"
        title="Перетащите для изменения ширины · Двойной щелчок — сброс"
        onPointerDown={(event) => startColumnResize("sidebar", event)}
        onDoubleClick={() =>
          setColumnWidths((current) =>
            ({
              ...current,
              sidebar: clamp(
                DEFAULT_COLUMN_WIDTHS.sidebar,
                190,
                Math.min(
                  340,
                  availableColumnWidth() - current.messageList - 380,
                ),
              ),
            }),
          )
        }
      />
      <main>
        <header className="topbar">
          <div className="search-box">
            <Search size={19} />
            <input
              ref={searchRef}
              placeholder="Поиск по вашей почте"
              aria-label="Поиск по почте"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search ? (
              <button
                className="icon-button"
                title="Очистить поиск"
                onClick={() => setSearch("")}
              >
                <X size={15} />
              </button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </div>
          <div
            className={`sync-state${syncError && !syncing ? " error" : ""}`}
            title={syncStatus}
          >
            <span className={syncing ? "status-dot syncing" : "status-dot"} />
            {syncStatus}
          </div>
          <button
            className="icon-button"
            title="Обновить почту"
            disabled={syncing || !accounts.some((a) => a.enabled)}
            onClick={() =>
              void sync(activeAccount ? [activeAccount] : accounts)
            }
          >
            <RefreshCw size={18} className={syncing ? "spin" : ""} />
          </button>
        </header>
        {!desktop && (
          <div className="preview-banner">
            Предпросмотр интерфейса · Для работы с почтой запустите
            desktop-приложение: <code>npm run tauri dev</code>
          </div>
        )}
        <div className="mail-layout">
          <section
            className="message-list"
            style={{ width: columnWidths.messageList }}
          >
            <div className="list-heading">
              <div>
                <span className="eyebrow">ВАША ПОЧТА, БЕЗ ЛИШНЕГО</span>
                <h1>
                  {title}
                  <span>
                    {messages.length +
                      (folder === "drafts" ? visibleDrafts.length : 0)}
                  </span>
                </h1>
              </div>
              <div className="list-heading-actions">
                <div className="sort-dropdown" ref={sortControlRef}>
                  <button
                    ref={sortButtonRef}
                    className={`sort-control ${sortOpen ? "open" : ""}`}
                    type="button"
                    aria-label="Сортировка писем"
                    aria-haspopup="listbox"
                    aria-expanded={sortOpen}
                    aria-controls="message-sort-menu"
                    onClick={() => (sortOpen ? setSortOpen(false) : openSort())}
                    onKeyDown={sortKeyDown}
                  >
                    <ArrowUpDown size={13} />
                    <span className="sort-label">
                      {
                        MESSAGE_SORT_OPTIONS.find(
                          (option) => option.value === messageSort,
                        )?.label
                      }
                    </span>
                    <ChevronDown
                      className="sort-chevron"
                      size={12}
                    />
                  </button>
                  {sortOpen && (
                    <div
                      className="sort-menu"
                      id="message-sort-menu"
                      role="listbox"
                      aria-label="Варианты сортировки"
                    >
                      {MESSAGE_SORT_OPTIONS.map((option, optionIndex) => (
                        <button
                          className={`sort-option ${activeSortIndex === optionIndex ? "active" : ""} ${messageSort === option.value ? "selected" : ""}`}
                          type="button"
                          role="option"
                          aria-selected={messageSort === option.value}
                          tabIndex={-1}
                          key={option.value}
                          onMouseEnter={() =>
                            setActiveSortIndex(optionIndex)
                          }
                          onClick={() => chooseSort(option.value)}
                        >
                          <span>{option.label}</span>
                          {messageSort === option.value && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  className="icon-button"
                  title="Обновить"
                  disabled={syncing || !accounts.some((a) => a.enabled)}
                  onClick={() =>
                    void sync(activeAccount ? [activeAccount] : accounts)
                  }
                >
                  <RefreshCw size={17} className={syncing ? "spin" : ""} />
                </button>
              </div>
            </div>
            <div className="account-filter">
              <span className="tiny-dot" />
              <select
                aria-label="Фильтр аккаунта"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  resetViewer();
                }}
              >
                <option value="">Все аккаунты</option>
                {accounts
                  .filter((a) => a.enabled)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.email}
                    </option>
                  ))}
              </select>
              <ChevronDown size={14} />
            </div>
            <div className="tabs">
              {[
                ["all", "Все"],
                ["unread", "Непрочитанные"],
                ["attachments", "С вложениями"],
              ].map(([id, label]) => (
                <button
                  className={filter === id ? "selected" : ""}
                  key={id}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="list-scroll">
              {folder === "drafts" &&
                visibleDrafts.map((d) => (
                  <button
                    className="message-card"
                    key={d.id}
                    onClick={() => setCompose(d)}
                  >
                    <div className="card-top">
                      <strong>Кому: {d.to || "Получатель не указан"}</strong>
                      <FileText size={14} />
                    </div>
                    <h3>{d.subject || "Без темы"}</h3>
                    <p>{d.body || "Пустой черновик"}</p>
                    <span className="account-tag">Локальный черновик</span>
                  </button>
                ))}
              {sortedMessages.map((m) => (
                <button
                  className={`message-card ${m.id === selectedId ? "selected" : ""} ${!m.read ? "unread" : ""}`}
                  key={m.id}
                  onClick={() => void choose(m)}
                >
                  <div className="card-top">
                    <span className="sender-name">
                      {!m.read && <i />}
                      <strong>{m.sender || m.senderEmail}</strong>
                    </span>
                    <time>{dateLabel(m.date)}</time>
                  </div>
                  <h3>{m.subject || "Без темы"}</h3>
                  <p>{m.snippet || "Нет текстового предпросмотра"}</p>
                  <div className="card-bottom">
                    <span className="account-tag">
                      {accounts.find((a) => a.id === m.accountId)?.name}
                    </span>
                    <span>
                      {m.hasAttachments && <Paperclip size={13} />}{" "}
                      {m.starred && <Star size={13} className="starred" />}
                    </span>
                  </div>
                </button>
              ))}
              {!messages.length &&
                !(folder === "drafts" && visibleDrafts.length) && (
                  <div className="list-empty">
                    <div className="empty-mini">
                      <Inbox size={28} />
                    </div>
                    <h3>
                      {search
                        ? "Ничего не найдено"
                        : !accounts.length
                          ? "Здесь будет ваша почта"
                          : "Пока писем нет"}
                    </h3>
                    <p>
                      {search
                        ? "Попробуйте другое имя, адрес или тему."
                        : !accounts.length
                          ? "Подключите аккаунт, чтобы получить первые письма."
                          : "Обновите почту или выберите другую папку."}
                    </p>
                    {!accounts.length && (
                      <button
                        className="text-button"
                        onClick={() => setAccountModal("new")}
                      >
                        Добавить аккаунт <ArrowUpRight size={14} />
                      </button>
                    )}
                  </div>
                )}
            </div>
            <div className="list-bottom">
              {syncing ? (
                <>
                  <LoaderCircle size={13} className="spin" />
                  {progressLabel
                    ? `Синхронизация… ${progressLabel}`
                    : "Синхронизация…"}
                </>
              ) : syncError ? (
                <>Ошибка синхронизации: {syncError}</>
              ) : (
                <>
                  <ShieldCheck size={13} />
                  Локальная почта · IMAP + SMTP
                </>
              )}
            </div>
          </section>
          <div
            className={`column-resizer ${activeResizer === "message-list" ? "active" : ""}`}
            role="separator"
            aria-label="Изменить ширину списка писем"
            aria-orientation="vertical"
            title="Перетащите для изменения ширины · Двойной щелчок — сброс"
            onPointerDown={(event) => startColumnResize("message-list", event)}
            onDoubleClick={() =>
              setColumnWidths((current) =>
                ({
                  ...current,
                  messageList: clamp(
                    DEFAULT_COLUMN_WIDTHS.messageList,
                    300,
                    Math.min(
                      700,
                      availableColumnWidth() - current.sidebar - 380,
                    ),
                  ),
                }),
              )
            }
          />
          <section className="viewer">
            {selected ? (
              <>
                <div className="viewer-toolbar">
                  <button
                    className="toolbar-reply"
                    onClick={() => setCompose(reply(selected, accounts))}
                  >
                    <Reply size={17} />
                    Ответить
                  </button>
                  <button
                    className="icon-button"
                    title="Ответить всем"
                    onClick={() => setCompose(reply(selected, accounts, true))}
                  >
                    <ReplyAll size={18} />
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className={`icon-button ${selected.starred ? "starred" : ""}`}
                    title={
                      selected.starred ? "Убрать звезду" : "Пометить звездой"
                    }
                    disabled={acting}
                    onClick={() =>
                      void action(selected.starred ? "unstar" : "star")
                    }
                  >
                    <Star size={18} />
                  </button>
                  <button
                    className="icon-button"
                    title={
                      selected.read
                        ? "Пометить непрочитанным"
                        : "Пометить прочитанным"
                    }
                    disabled={acting}
                    onClick={() =>
                      void action(selected.read ? "unread" : "read")
                    }
                  >
                    {selected.read ? (
                      <Mail size={18} />
                    ) : (
                      <MailOpen size={18} />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    title="Переместить в корзину"
                    disabled={acting || selected.kind === "trash"}
                    onClick={() => void action("delete")}
                  >
                    <Trash2 size={18} />
                  </button>
                  <button
                    className="icon-button"
                    title="Обновить"
                    disabled={syncing}
                    onClick={() =>
                      void sync(
                        accounts.filter((a) => a.id === selected.accountId),
                      )
                    }
                  >
                    <RefreshCw size={17} className={syncing ? "spin" : ""} />
                  </button>
                  <span className="spacer" />
                  <small>
                    {index >= 0 ? index + 1 : "—"} из {messages.length}
                  </small>
                  <button
                    className="icon-button"
                    title="Предыдущее письмо"
                    disabled={index <= 0}
                    onClick={() => void choose(sortedMessages[index - 1])}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <button
                    className="icon-button"
                    title="Следующее письмо"
                    disabled={index < 0 || index >= sortedMessages.length - 1}
                    onClick={() => void choose(sortedMessages[index + 1])}
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
                <article className="message-content">
                  <div className="message-account">
                    <span className="tiny-dot" />
                    {accounts.find((a) => a.id === selected.accountId)?.email}
                    <span className="message-kind">
                      {navigation.find((n) => n[0] === selected.kind)?.[1]}
                    </span>
                  </div>
                  <h2>{selected.subject || "Без темы"}</h2>
                  <div className="sender-block">
                    <div className="sender-avatar">
                      {initials(selected.sender || selected.senderEmail)}
                    </div>
                    <div className="sender-details">
                      <strong>{selected.sender}</strong>
                      <span>{selected.senderEmail}</span>
                      <small>
                        Кому: {selected.to}
                        {selected.cc && ` · Копия: ${selected.cc}`}
                      </small>
                    </div>
                    <time>
                      {new Date(selected.date * 1000).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  {selected.html && (
                    <div className="images-notice">
                      <ShieldCheck size={14} />
                      {images
                        ? "Внешние изображения разрешены для этого письма"
                        : "Внешние изображения заблокированы"}
                      <button onClick={() => setImages(!images)}>
                        {images ? "Заблокировать" : "Загрузить изображения"}
                      </button>
                    </div>
                  )}
                  {selected.html ? (
                    <iframe
                      title="Содержимое письма"
                      className="email-frame"
                      sandbox=""
                      referrerPolicy="no-referrer"
                      srcDoc={html}
                    />
                  ) : (
                    <div className="text-body">
                      {selected.text || "В письме нет текстового содержимого."}
                    </div>
                  )}
                  {selected.attachments.length > 0 && (
                    <div className="attachments">
                      <h4>
                        <Paperclip size={16} /> Вложения ·{" "}
                        {selected.attachments.length}
                      </h4>
                      {selected.attachments.map((a, i) => (
                        <button
                          className="attachment"
                          key={i}
                          onClick={() =>
                            void api("save_attachment", {
                              id: selected.id,
                              index: i,
                            }).catch((e) => notify(errorText(e), true))
                          }
                        >
                          <div className="file-icon">
                            <FileText size={21} />
                          </div>
                          <span>
                            <strong>{a.name}</strong>
                            <small>{(a.size / 1024).toFixed(1)} КБ</small>
                          </span>
                          <ArrowDownToLine size={16} />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="bottom-reply">
                    <button
                      className="secondary"
                      onClick={() => setCompose(reply(selected, accounts))}
                    >
                      <Reply size={17} />
                      Ответить
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        setCompose(reply(selected, accounts, true))
                      }
                    >
                      <ReplyAll size={17} />
                      Ответить всем
                    </button>
                  </div>
                </article>
              </>
            ) : loading ? (
              <div className="welcome">
                <LoaderCircle size={30} className="spin" />
                <h2>Открываем письмо…</h2>
              </div>
            ) : (
              <div className="welcome">
                <div className="welcome-orbit">
                  <span />
                  <span />
                  <div className="welcome-icon">
                    <Mail size={42} strokeWidth={1.2} />
                  </div>
                  <i className="orbit-dot one" />
                  <i className="orbit-dot two" />
                </div>
                <span className="eyebrow">МЕНЬШЕ ШУМА. БОЛЬШЕ ВАЖНОГО.</span>
                <h2>
                  {accounts.length
                    ? "Место для вашей почты"
                    : "Вся ваша почта.\nВ одном месте."}
                </h2>
                <p>
                  {accounts.length
                    ? "Выберите письмо слева, чтобы прочитать его\nи продолжить разговор."
                    : "Рабочие и личные письма — рядом.\nПодключите первый аккаунт и начните с главного."}
                </p>
                {!accounts.length && (
                  <button
                    className="primary"
                    onClick={() => setAccountModal("new")}
                  >
                    <Plus size={17} />
                    Подключить аккаунт
                  </button>
                )}
                <div className="welcome-features">
                  <span>
                    <ShieldCheck size={15} />
                    Локально и приватно
                  </span>
                  <i />
                  <span>
                    <Mail size={15} />
                    Несколько аккаунтов
                  </span>
                </div>
                <div className="welcome-footer">
                  Никаких отвлечений. Только ваша почта.
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <Shield size={19} /> : <Check size={19} />}
          <span>{notice.text}</span>
          <button
            className="icon-button"
            title="Закрыть уведомление"
            onClick={() => setNotice(null)}
          >
            <X size={17} />
          </button>
        </div>
      )}
      {accountModal && (
        <AccountModal
          account={accountModal === "new" ? undefined : accountModal}
          onClose={() => setAccountModal(null)}
          onSaved={async (a, shouldSync) => {
            await loadAccounts();
            notify("Аккаунт сохранён");
            if (shouldSync) void sync([a]);
          }}
        />
      )}
      {compose && (
        <ComposeModal
          initial={compose}
          accounts={accounts}
          onClose={() => {
            setCompose(null);
            void load().catch((e) => notify(errorText(e), true));
          }}
          onSent={(message) => {
            setCompose(null);
            notify(message);
            void load().catch((e) => notify(errorText(e), true));
            void sync(accounts);
          }}
        />
      )}
      {rename && (
        <Modal title="Переименовать аккаунт" onClose={() => setRename(null)}>
          <form
            className="small-form"
            onSubmit={(e) => {
              e.preventDefault();
              void accountAction(rename, "rename", newName);
            }}
          >
            <label>
              Название аккаунта
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={rename.email}
              />
            </label>
            <p>Адрес и настройки подключения останутся прежними.</p>
            <footer>
              <span className="spacer" />
              <button
                type="button"
                className="quiet"
                onClick={() => setRename(null)}
              >
                Отмена
              </button>
              <button className="primary">Сохранить</button>
            </footer>
          </form>
        </Modal>
      )}
      {remove && (
        <Modal title="Удалить аккаунт?" onClose={() => setRemove(null)}>
          <div className="small-form">
            <p>
              Удалить <strong>{remove.email}</strong>, его локальные письма,
              черновики и сохранённые пароли с этого устройства? Письма на
              сервере сохранятся.
            </p>
            <footer>
              <span className="spacer" />
              <button className="quiet" onClick={() => setRemove(null)}>
                Отмена
              </button>
              <button
                className="danger-button"
                onClick={() => void accountAction(remove, "delete")}
              >
                Удалить аккаунт
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
