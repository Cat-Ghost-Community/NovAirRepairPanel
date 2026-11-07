"use client";

import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { Icon } from "@/components/icon";
import { toEnDigits } from "@/lib/format";

type Option = { value: string; label: string; disabled: boolean; group?: string };
const textOf = (node: ReactNode): string => Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : String(child)).join("");
const normalize = (value: string) => toEnDigits(value).normalize("NFKC").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[\u200c\u200e\u200f]/g, " ").toLocaleLowerCase("fa").trim();
function nativeLabel(element: HTMLSelectElement | null) {
  return Array.from(element?.labels ?? []).map(label => {
    const title = label.querySelector(".label, .filter-label");
    if (title) return title.textContent?.trim() ?? "";
    const clone = label.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("select,button,input,[popover]").forEach(node => node.remove());
    return clone.textContent?.trim() ?? "";
  }).join(" ");
}

function optionsOf(children: ReactNode, group?: string, disabled = false): Option[] {
  const result: Option[] = [];
  Children.forEach(children, child => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; label?: string; disabled?: boolean }>(child)) return;
    if (child.type === "option") {
      const label = child.props.label ?? textOf(child.props.children);
      result.push({ value: String(child.props.value ?? label), label, disabled: disabled || !!child.props.disabled, group });
    } else result.push(...optionsOf(child.props.children, child.type === "optgroup" ? child.props.label : group, disabled || !!child.props.disabled));
  });
  return result;
}

// Top-layer popovers still have scrolling DOM ancestors. Browser focus/option
// navigation can scroll a dialog; keep the picker anchored instead of closing
// it before the user can select an option.
function placePanel(trigger:HTMLButtonElement,panel:HTMLDivElement){
  const rect=trigger.getBoundingClientRect(),width=Math.min(Math.max(rect.width,260),window.innerWidth-16);
  const below=window.innerHeight-rect.bottom-8,above=rect.top-8,height=Math.min(360,Math.max(below,above));
  Object.assign(panel.style,{width:`${width}px`,maxHeight:`${height}px`,left:`${Math.max(8,Math.min(rect.right-width,window.innerWidth-width-8))}px`,top:below>=Math.min(300,above)?`${rect.bottom+4}px`:'auto',bottom:below>=Math.min(300,above)?'auto':`${window.innerHeight-rect.top+4}px`});
}

/** Search UI with a real select underneath: native FormData, reset, validation and change events remain intact. */
export function SearchableSelect({ children, className = "input", value, defaultValue, onChange, triggerAdornment,triggerCaption,onSearchChange,...props }: SelectHTMLAttributes<HTMLSelectElement>&{triggerAdornment?:ReactNode;triggerCaption?:string;onSearchChange?:(query:string)=>void}) {
  const uid = useId();
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [localValue, setLocalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [fieldLabel, setFieldLabel] = useState("");
  const [invalid, setInvalid] = useState(false);
  const options = optionsOf(children);
  const selected = options.find(o => o.value === String(value ?? localValue ?? options[0]?.value));
  const filtered = options.filter(o => normalize(`${o.label} ${o.group ?? ""}`).includes(normalize(query)));
  const listId = `${uid}-options`;
  const fieldId = props.id;
  const explicitLabel = props["aria-label"];

  useEffect(() => {
    const element = native.current;
    if (!element) return;
    const label = explicitLabel ?? nativeLabel(element);
    if (label) trigger.current?.setAttribute("aria-label", label);
    const reset = () => requestAnimationFrame(() => setLocalValue(element.value));
    element.form?.addEventListener("reset", reset);
    return () => element.form?.removeEventListener("reset", reset);
  }, [fieldId, explicitLabel, children]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.type === "scroll") {
        if(event.target instanceof Node&&panel.current?.contains(event.target))return;
        if(trigger.current&&panel.current)placePanel(trigger.current,panel.current);
        return;
      }
      panel.current?.hidePopover(); setOpen(false);
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => { window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [open]);

  const close = (focus = false) => {
    panel.current?.hidePopover();
    setOpen(false);
    if (focus) trigger.current?.focus({ preventScroll: true });
  };
  const choose = (option: Option) => {
    if (option.disabled || props.disabled || !native.current) return;
    // A bubbling native change preserves existing React handlers and GET filter forms.
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(native.current, option.value);
    native.current.dispatchEvent(new Event("change", { bubbles: true }));
    close(true);
  };
  const show = () => {
    if (!panel.current || !trigger.current || props.disabled) return;
    if (open) return close(true);
    const label = props["aria-label"] ?? nativeLabel(native.current);
    setFieldLabel(label || "انتخاب گزینه");
    setQuery("");
    onSearchChange?.("");
    setActive(options.findIndex(o => o.value === selected?.value && !o.disabled));
    placePanel(trigger.current,panel.current);
    panel.current.showPopover();
    setOpen(true);
    requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
  };

  return <>
    <select {...props} ref={native} value={value} defaultValue={defaultValue} tabIndex={-1} aria-hidden="true"
      className="search-select-native" onFocus={() => trigger.current?.focus({preventScroll:true})}
      onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); props.onInvalid?.(event); }}
      onChange={event => { setInvalid(false); setLocalValue(event.target.value); onChange?.(event); }}>
      {children}
    </select>
    <button ref={trigger} type="button" role="combobox" aria-haspopup="listbox" aria-controls={listId} aria-expanded={open}
      aria-label={props["aria-label"] || fieldLabel || selected?.label || "انتخاب گزینه"} aria-labelledby={props["aria-labelledby"]}
      aria-required={props.required} aria-invalid={invalid || props["aria-invalid"]} aria-describedby={invalid ? `${uid}-error` : props["aria-describedby"]}
      disabled={props.disabled} title={selected?.label} style={props.style}
      className={`${className} search-select-trigger`} onClick={show}
      onKeyDown={event => { if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); show(); } }}>
      {triggerAdornment}
      <span className="min-w-0 flex-1 truncate text-start">{triggerCaption&&<span className="hidden text-[10px] font-normal leading-3 opacity-70 sm:block">{triggerCaption}</span>}<span className="block truncate">{selected?.label || "انتخاب کنید"}</span></span>
      <Icon name="chevron-down" size={15} className="shrink-0 text-zinc-400" />
    </button>
    {invalid && <span id={`${uid}-error`} role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">لطفاً یک گزینه انتخاب کنید.</span>}
    <div ref={panel} popover="auto" dir="rtl" className="search-select-panel" onToggle={event => {
      const visible = (event.nativeEvent as ToggleEvent).newState === "open";
      setOpen(visible);
      if (!visible && panel.current?.contains(document.activeElement)) trigger.current?.focus({preventScroll:true});
    }} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
      if (event.key === "Tab") close();
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        if ((event.key === "Home" || event.key === "End") && event.target === search.current) return;
        event.preventDefault();
        const enabled = filtered.map((o,i) => o.disabled ? -1 : i).filter(i => i >= 0);
        const index = enabled.indexOf(active);
        const next = event.key === "Home" ? enabled[0] : event.key === "End" ? enabled.at(-1) : index < 0 ? (event.key === "ArrowUp" ? enabled.at(-1) : enabled[0]) : enabled[(index + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length];
        setActive(next ?? -1);
        if (next !== undefined) document.getElementById(`${uid}-${next}`)?.scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Enter" && event.target === search.current) { event.preventDefault(); const option = filtered[active]; if (option) choose(option); }
    }}>
      <div className="relative shrink-0 border-b border-zinc-200 p-2 dark:border-zinc-800">
        <Icon name="search" size={16} className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input ref={search} type="search" role="combobox" autoComplete="off" aria-label={`جستجو در ${fieldLabel || "گزینه‌ها"}`} aria-expanded={open} aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${uid}-${active}` : undefined} className="input !pr-9" placeholder="جستجو در گزینه‌ها…" value={query}
          onChange={event => { setQuery(event.target.value); setActive(-1);onSearchChange?.(event.target.value); }}
          onKeyDown={event => { if (event.key === "Enter" && active < 0) { event.preventDefault(); const option = filtered.find(o => !o.disabled); if (option) choose(option); } }} />
      </div>
      <div id={listId} role="listbox" aria-label={fieldLabel || "گزینه‌ها"} className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
        {filtered.length ? filtered.map((option, index) => <button key={`${option.value}-${index}`} id={`${uid}-${index}`} type="button" role="option" tabIndex={-1}
          aria-selected={option.value === selected?.value} disabled={option.disabled}
          className={`search-select-option ${index === active ? "bg-zinc-100 dark:bg-zinc-800" : ""} ${option.value === selected?.value ? "text-brand-700 dark:text-brand-300" : ""}`}
          onClick={() => choose(option)} onPointerMove={() => setActive(index)}>
          <span className="min-w-0 flex-1 break-words">{option.group && <span className="block text-[11px] text-zinc-400">{option.group}</span>}{option.label || "بدون انتخاب"}</span>
          {option.value === selected?.value && <Icon name="check" size={16} className="shrink-0" />}
        </button>) : <p role="status" className="px-3 py-6 text-center text-sm text-zinc-500">گزینه‌ای پیدا نشد؛ عبارت دیگری جستجو کنید.</p>}
      </div>
    </div>
  </>;
}
