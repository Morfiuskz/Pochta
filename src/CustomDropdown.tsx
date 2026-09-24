import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

export default function CustomDropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  icon,
  className = "",
}: {
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  icon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options.find((option) => option.value === value);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };
  const select = (next: T) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!options.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (current) => (current + step + options.length) % options.length,
      );
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && options[activeIndex]) select(options[activeIndex].value);
      else openMenu();
    }
  };

  return (
    <div
      className={`custom-dropdown ${className}`.trim()}
      ref={root}
    >
      <button
        ref={trigger}
        className={`dropdown-trigger ${open ? "open" : ""}`}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={!options.length}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={keyDown}
      >
        {icon}
        <span className="dropdown-label">{selected?.label || ariaLabel}</span>
        <ChevronDown className="dropdown-chevron" size={12} />
      </button>
      {open && (
        <div
          className="dropdown-menu"
          id={menuId}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, optionIndex) => (
            <button
              className={`dropdown-option ${activeIndex === optionIndex ? "active" : ""} ${value === option.value ? "selected" : ""}`}
              type="button"
              role="option"
              aria-selected={value === option.value}
              tabIndex={-1}
              key={option.value}
              onMouseEnter={() => setActiveIndex(optionIndex)}
              onClick={() => select(option.value)}
            >
              <span>{option.label}</span>
              {value === option.value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
