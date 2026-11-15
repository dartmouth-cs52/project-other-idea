import { X } from "lucide-react";
import { ContextMenu as RContext, Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useLab } from "@/lab/lab";
import { Button } from "./button";
import { Input } from "./form";
import { PortalContainer, usePortalContainer } from "./portal";

// Dialogs, drawers and menus. Modal switches between Radix's portaled dialog
// and a native <dialog>.showModal() from the test panel, because the two
// behave differently for anything else drawn on the page.

const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof widths;
  children?: ReactNode;
  /** Stop Escape and outside clicks from closing it, for flows with unsaved input. */
  dismissable?: boolean;
}

export function Modal(props: ModalProps) {
  const native = useLab((s) => s.nativeDialogs);
  return native ? <NativeModal {...props} /> : <RadixModal {...props} />;
}

function ModalBody({ title, description, footer, children, onClose, TitleTag, DescTag }: ModalProps & { onClose: () => void; TitleTag: React.ElementType; DescTag: React.ElementType }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="flex flex-col gap-1">
          <TitleTag className="text-[15px] font-semibold text-ink">{title}</TitleTag>
          {description ? <DescTag className="text-[13px] text-ink-2">{description}</DescTag> : null}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer ? <div className="flex items-center justify-end gap-2 border-t border-line bg-sunken/60 px-5 py-3">{footer}</div> : null}
    </>
  );
}

function RadixModal(props: ModalProps) {
  const { open, onOpenChange, size = "md", dismissable = true } = props;
  const container = usePortalContainer();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal container={container}>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <RDialog.Content
          {...(props.description ? {} : { "aria-describedby": undefined })}
          onEscapeKeyDown={(e) => !dismissable && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissable && e.preventDefault()}
          className={cn("fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 animate-in rounded-lg border border-line bg-panel shadow-2xl", widths[size])}
        >
          <ModalBody {...props} onClose={() => onOpenChange(false)} TitleTag={RDialog.Title} DescTag={props.description ? RDialog.Description : "p"} />
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

function NativeModal(props: ModalProps) {
  const { open, onOpenChange, size = "md", dismissable = true } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const [el, setEl] = useState<HTMLDialogElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={(node) => {
        ref.current = node;
        setEl(node);
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onOpenChange(false);
      }}
      onClick={(e) => {
        if (dismissable && e.target === e.currentTarget) onOpenChange(false);
      }}
      className={cn("m-auto mt-[12vh] w-[calc(100vw-2rem)] rounded-lg border border-line bg-panel p-0 text-ink shadow-2xl", widths[size])}
    >
      {open ? (
        <PortalContainer.Provider value={el}>
          <ModalBody {...props} onClose={() => onOpenChange(false)} TitleTag="h2" DescTag="p" />
        </PortalContainer.Provider>
      ) : null}
    </dialog>
  );
}

/** A panel that slides in from the right. */
export function Sheet({ open, onOpenChange, title, description, footer, children, width = "max-w-md" }: Omit<ModalProps, "size"> & { width?: string }) {
  const container = usePortalContainer();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal container={container}>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <RDialog.Content className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-panel shadow-2xl", width)}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="flex flex-col gap-1">
              <RDialog.Title className="text-[15px] font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="text-[13px] text-ink-2">{description}</RDialog.Description> : <RDialog.Description className="sr-only">Details</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close panel">
                <X />
              </Button>
            </RDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/**
 * Asks before something that can't be undone. With `confirmText`, the person
 * has to type it first, like "DELETE".
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  confirmText,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const ready = !confirmText || typed === confirmText;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!ready}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {confirmText ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="confirm-text" className="text-[13px] text-ink-2">
            Type <span className="font-mono font-semibold text-ink">{confirmText}</span> to confirm.
          </label>
          <Input id="confirm-text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      ) : (
        <p className="text-[13px] text-ink-2">This can't be undone.</p>
      )}
    </Modal>
  );
}

const menuSurface = "z-[70] min-w-48 animate-in overflow-hidden rounded-md border border-line bg-panel p-1 shadow-lg";
const menuItem =
  "relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-ink outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-sunken [&_svg]:size-4 [&_svg]:text-ink-3";

export interface MenuEntry {
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Turns the entry into a submenu. */
  items?: MenuEntry[];
  separator?: boolean;
  heading?: string;
}

function renderItems(items: MenuEntry[], Kit: typeof RMenu | typeof RContext, container?: HTMLElement): ReactNode {
  return items.map((item, i) => {
    if (item.separator) return <Kit.Separator key={i} className="my-1 h-px bg-line" />;
    if (item.heading) return <Kit.Label key={i} className="px-2 py-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{item.heading}</Kit.Label>;
    if (item.items)
      return (
        <Kit.Sub key={i}>
          <Kit.SubTrigger className={menuItem}>
            {item.icon}
            {item.label}
            <span className="ml-auto text-ink-3">›</span>
          </Kit.SubTrigger>
          <Kit.Portal container={container}>
            <Kit.SubContent className={menuSurface} sideOffset={4}>
              {renderItems(item.items, Kit, container)}
            </Kit.SubContent>
          </Kit.Portal>
        </Kit.Sub>
      );
    return (
      <Kit.Item key={i} disabled={item.disabled} onSelect={item.onSelect} className={cn(menuItem, item.danger && "text-danger [&_svg]:text-danger")}>
        {item.icon}
        {item.label}
        {item.shortcut ? <span className="ml-auto pl-4 text-xs text-ink-3">{item.shortcut}</span> : null}
      </Kit.Item>
    );
  });
}

/** A dropdown menu on a trigger. */
export function Menu({ trigger, items, align = "end", label }: { trigger: ReactNode; items: MenuEntry[]; align?: "start" | "end" | "center"; label?: string }) {
  const container = usePortalContainer();
  return (
    <RMenu.Root modal={false}>
      <RMenu.Trigger asChild aria-label={label}>
        {trigger}
      </RMenu.Trigger>
      <RMenu.Portal container={container}>
        <RMenu.Content align={align} sideOffset={4} className={menuSurface}>
          {renderItems(items, RMenu, container)}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

/** A right-click menu around its children. */
export function ContextMenu({ items, children }: { items: MenuEntry[]; children: ReactNode }) {
  const container = usePortalContainer();
  return (
    <RContext.Root>
      <RContext.Trigger asChild>{children}</RContext.Trigger>
      <RContext.Portal container={container}>
        <RContext.Content className={menuSurface}>{renderItems(items, RContext, container)}</RContext.Content>
      </RContext.Portal>
    </RContext.Root>
  );
}

export function Popover({
  trigger,
  children,
  align = "start",
  className,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const container = usePortalContainer();
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal container={container}>
        <RPopover.Content align={align} sideOffset={6} className={cn("z-[70] animate-in rounded-lg border border-line bg-panel p-3 shadow-lg outline-none", className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
