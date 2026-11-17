import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Columns3 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { EmptyState } from "./display";
import { Checkbox } from "./form";
import { Popover } from "./overlay";

// One table for every list in the app. It sorts, hides columns, selects rows
// for bulk actions, expands a row in place, and virtualizes long lists so only
// the rows on screen exist in the DOM. That last one matters for a guide: the
// row someone asks about may not be in the page until they scroll to it.

export type { ColumnDef };

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  /** Render list items only for rows on screen. Turn on for long lists. */
  virtual?: boolean;
  /** Height of the scroll area when virtual, or a max height otherwise. */
  height?: number | string;
  selectable?: boolean;
  selection?: RowSelectionState;
  onSelectionChange?: (s: RowSelectionState) => void;
  onRowClick?: (row: T) => void;
  /** Actions that appear when the pointer is over a row, at its right edge. Hidden, not removed, otherwise. */
  rowActions?: (row: T) => ReactNode;
  /** Content shown under a row when its chevron is pressed. */
  renderExpanded?: (row: T) => ReactNode;
  /** Shown above the table when rows are selected. */
  bulkActions?: (selected: string[], clear: () => void) => ReactNode;
  columnPicker?: boolean;
  initialHidden?: string[];
  initialSort?: SortingState;
  empty?: ReactNode;
  toolbar?: ReactNode;
  className?: string;
  /** Label for the table, read by screen readers. */
  label: string;
  rowHeight?: number;
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  virtual,
  height = 560,
  selectable,
  selection: controlledSelection,
  onSelectionChange,
  onRowClick,
  rowActions,
  renderExpanded,
  bulkActions,
  columnPicker,
  initialHidden = [],
  initialSort = [],
  empty,
  toolbar,
  className,
  label,
  rowHeight = 44,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSort);
  const [visibility, setVisibility] = useState<VisibilityState>(() => Object.fromEntries(initialHidden.map((id) => [id, false])));
  const [ownSelection, setOwnSelection] = useState<RowSelectionState>({});
  const selection = controlledSelection ?? ownSelection;
  const setSelection = (s: RowSelectionState) => (onSelectionChange ? onSelectionChange(s) : setOwnSelection(s));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    const out: ColumnDef<T, unknown>[] = [];
    if (selectable)
      out.push({
        id: "_select",
        size: 36,
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllRowsSelected(v)}
            label={<span className="sr-only">Select all</span>}
          />
        ),
        cell: ({ row }) => (
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(v)} label={<span className="sr-only">Select row</span>} />
          </span>
        ),
      });
    if (renderExpanded)
      out.push({
        id: "_expand",
        size: 32,
        enableSorting: false,
        enableHiding: false,
        header: () => null,
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={expanded[row.id] ? "Collapse row" : "Expand row"}
            aria-expanded={!!expanded[row.id]}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((x) => ({ ...x, [row.id]: !x[row.id] }));
            }}
            className="grid size-6 cursor-pointer place-items-center rounded text-ink-3 hover:bg-sunken hover:text-ink"
          >
            {expanded[row.id] ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ),
      });
    return [...out, ...columns];
  }, [columns, selectable, renderExpanded, expanded]);

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId: (r) => getRowId(r),
    state: { sorting, columnVisibility: visibility, rowSelection: selection },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: (u) => setSelection(typeof u === "function" ? u(selection) : u),
    enableRowSelection: !!selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });
  useEffect(() => {
    if (virtual) virtualizer.measure();
  }, [virtual, expanded, virtualizer]);

  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const visibleLeaf = table.getVisibleLeafColumns();
  const gridTemplate = visibleLeaf.map((c) => (c.columnDef.size && c.columnDef.size !== 150 ? `${c.columnDef.size}px` : "minmax(110px, 1fr)")).join(" ") + (rowActions ? " 0px" : "");

  const renderRow = (row: (typeof rows)[number], style?: React.CSSProperties, measure?: (el: Element | null) => void, index?: number) => (
    <div key={row.id} ref={measure} data-index={index} style={style} className="group/row">
      <div
        role="row"
        aria-selected={row.getIsSelected() || undefined}
        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
        className={cn("relative grid items-center border-b border-line text-[13px] hover:bg-sunken/70", onRowClick && "cursor-pointer", row.getIsSelected() && "bg-brand-soft/50")}
        style={{ gridTemplateColumns: gridTemplate, minHeight: rowHeight }}
      >
        {row.getVisibleCells().map((cell) => (
          <div role="cell" key={cell.id} className="min-w-0 truncate px-3 py-2">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        ))}
        {rowActions ? (
          // Visible only on hover, like most dashboards. Still in the DOM and focusable. A touch screen has no hover, so
          // there they always show. Only the buttons take a press: the fade behind them lets a tap through to the row.
          <div
            role="cell"
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 bg-gradient-to-l from-panel via-panel to-transparent pr-2 pl-8 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 [&>*]:pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {rowActions(row.original)}
          </div>
        ) : null}
      </div>
      {renderExpanded && expanded[row.id] ? <div className="border-b border-line bg-sunken/50 px-12 py-3">{renderExpanded(row.original)}</div> : null}
    </div>
  );

  return (
    <div className={cn("relative flex flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xs", className)}>
      {toolbar || columnPicker || (bulkActions && selectedIds.length) ? (
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          {bulkActions && selectedIds.length ? (
            <div className="flex flex-1 flex-wrap items-center gap-2" role="toolbar" aria-label="Bulk actions">
              <span className="text-[13px] font-medium">{selectedIds.length} selected</span>
              {bulkActions(selectedIds, () => setSelection({}))}
              <Button variant="ghost" size="sm" onClick={() => setSelection({})}>
                Clear selection
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          )}
          {columnPicker ? (
            <Popover
              align="end"
              className="w-56"
              trigger={
                <Button size="sm" variant="ghost">
                  <Columns3 /> Columns
                </Button>
              }
            >
              <p className="mb-2 text-xs font-medium text-ink-3">Show columns</p>
              <div className="flex flex-col gap-2">
                {table
                  .getAllLeafColumns()
                  .filter((c) => c.getCanHide())
                  .map((c) => (
                    <Checkbox key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(v)} label={typeof c.columnDef.header === "string" ? c.columnDef.header : c.id} />
                  ))}
              </div>
            </Popover>
          ) : null}
        </div>
      ) : null}

      <div ref={scrollRef} role="table" aria-label={label} aria-rowcount={rows.length} className="relative overflow-auto" style={{ height: virtual ? height : undefined, maxHeight: virtual ? undefined : height }}>
        <div role="rowgroup" className="sticky top-0 z-10 bg-sunken">
          {table.getHeaderGroups().map((hg) => (
            <div role="row" key={hg.id} className="grid border-b border-line" style={{ gridTemplateColumns: gridTemplate }}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                return (
                  <div role="columnheader" key={h.id} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined} className="px-3 py-2 text-left text-[12px] font-medium text-ink-3">
                    {h.column.getCanSort() ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex cursor-pointer items-center gap-1 hover:text-ink">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {rows.length === 0 ? (
          (empty ?? <EmptyState title="Nothing here" description="Try changing the filters." />)
        ) : virtual ? (
          <div role="rowgroup" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) =>
              renderRow(rows[v.index], { position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` }, virtualizer.measureElement, v.index),
            )}
          </div>
        ) : (
          <div role="rowgroup">
            {rows.map((r) => (
              <Fragment key={r.id}>{renderRow(r)}</Fragment>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-ink-3">
        <span className="tabular">{rows.length.toLocaleString()} rows</span>
      </div>
    </div>
  );
}

/** Simple pagination for tables that page instead of scrolling. */
export function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="tabular text-ink-2">
        Page {page} of {Math.max(1, pageCount)}
      </span>
      <Button size="sm" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  );
}
