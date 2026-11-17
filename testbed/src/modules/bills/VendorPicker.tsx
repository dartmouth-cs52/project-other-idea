import { Command } from "cmdk";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ME_ID, newId, upsert, useCollection } from "@/data/store";
import type { Vendor } from "@/data/types";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/display";
import { act } from "@/ui/flow";
import { Field, Input, NativeSelect } from "@/ui/form";
import { Modal, Popover } from "@/ui/overlay";
import { requestApproval, TERMS_LABELS, VENDOR_CATEGORIES } from "./shared";

/**
 * A searchable vendor list with "Add new vendor" pinned to the bottom. That
 * item opens a modal from inside a portaled popover.
 */
export function VendorPicker({ value, onChange, id, invalid }: { value: string | null; onChange: (id: string) => void; id?: string; invalid?: boolean }) {
  const vendors = useCollection("vendors");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const current = vendors.find((v) => v.id === value);
  const usable = vendors.filter((v) => v.status !== "blocked");
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
        trigger={
          <button
            type="button"
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            className="flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-line-strong bg-panel px-2.5 text-left text-[13px] shadow-xs outline-none hover:bg-sunken/50 focus:border-brand focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-danger"
          >
            <span className={cn("truncate", !current && "text-ink-3")}>{current?.name ?? "Choose a vendor"}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-ink-3" />
          </button>
        }
      >
        <Command loop>
          <Command.Input value={search} onValueChange={setSearch} placeholder="Search vendors…" className="h-9 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-ink-3" />
          <Command.List className="max-h-64 overflow-y-auto p-1">
            <Command.Empty className="px-3 py-4 text-center text-[13px] text-ink-3">No vendor called "{search}".</Command.Empty>
            {usable.map((v) => (
              <Command.Item
                key={v.id}
                value={`${v.name} ${v.legalName}`}
                onSelect={() => {
                  onChange(v.id);
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] data-[selected=true]:bg-sunken"
              >
                <Check className={cn("size-3.5 shrink-0", v.id === value ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{v.name}</span>
                <span className="ml-auto pl-3 text-xs text-ink-3">{v.status === "pending_review" ? "Pending review" : v.category}</span>
              </Command.Item>
            ))}
          </Command.List>
          <div className="border-t border-line p-1">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setAdding(true);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] font-medium text-brand hover:bg-sunken"
            >
              <Plus className="size-3.5" /> Add new vendor{search ? ` "${search}"` : ""}
            </button>
          </div>
        </Command>
      </Popover>
      <QuickVendorModal
        open={adding}
        onOpenChange={setAdding}
        initialName={search}
        onCreated={(v) => {
          onChange(v.id);
          setSearch("");
        }}
      />
    </>
  );
}

/** The short version of vendor onboarding, for when you're in the middle of entering a bill. */
export function QuickVendorModal({ open, onOpenChange, initialName, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; initialName: string; onCreated: (v: Vendor) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState(VENDOR_CATEGORIES[0]);
  const [terms, setTerms] = useState<Vendor["terms"]>("net30");
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setEmail("");
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    const e: typeof errors = {};
    if (!name.trim()) e.name = "Enter the vendor's name.";
    if (!/^\S+@\S+\.\S+$/.test(email)) e.email = "Enter a billing email, like billing@vendor.com.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const vendor: Vendor = {
      id: newId("ven"),
      name: name.trim(),
      legalName: name.trim(),
      email,
      phone: "",
      website: "",
      category,
      paymentMethod: "ach",
      routingNumber: "",
      accountNumber: "",
      taxId: "",
      w9OnFile: false,
      address: "",
      ownerId: ME_ID,
      status: "pending_review",
      terms,
      createdAt: new Date().toISOString(),
    };
    const ok = await act(
      () => {
        upsert("vendors", vendor);
        requestApproval("vendor", vendor.id, `Add vendor ${vendor.name}`);
        return true;
      },
      { success: `${vendor.name} added. It needs approval before you can pay it.` },
    );
    setBusy(false);
    if (ok) {
      onCreated(vendor);
      onOpenChange(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add new vendor"
      description="Add the basics now. You can fill in bank and tax details from the vendor's page."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Add vendor
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Vendor name" error={errors.name}>
          {(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />}
        </Field>
        <Field label="Billing email" error={errors.email}>
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} placeholder="billing@vendor.com" />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            {(id) => (
              <NativeSelect id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {VENDOR_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label="Payment terms">
            {(id) => (
              <NativeSelect id={id} value={terms} onChange={(e) => setTerms(e.target.value as Vendor["terms"])}>
                {(Object.keys(TERMS_LABELS) as Vendor["terms"][]).map((t) => (
                  <option key={t} value={t}>
                    {TERMS_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <Callout tone="info">New vendors go to Finance for approval. You can save bills for them in the meantime.</Callout>
      </div>
    </Modal>
  );
}
