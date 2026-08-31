import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  tableFeatures,
  useTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button, Select, cn } from "../../ui";

export const adminTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
});

export type AdminTableFeatures = typeof adminTableFeatures;
export type AdminColumnDef<TData extends RowData> = ColumnDef<AdminTableFeatures, TData, any>;
export type TableDensity = "compact" | "regular";

const DENSITY_KEY = "mr.admin.table-density";
const EMPTY_DATA: RowData[] = [];
const INTERACTIVE_ROW_TARGET = "button,a,input,select,textarea,[role='button']";

function isInteractiveTarget(target: EventTarget | null, container?: Element | null) {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(INTERACTIVE_ROW_TARGET);
  return Boolean(interactive && interactive !== container);
}

export function createAdminColumnHelper<TData extends RowData>() {
  return createColumnHelper<AdminTableFeatures, TData>();
}

export function useTableDensity() {
  const [density, setDensity] = useState<TableDensity>(() =>
    localStorage.getItem(DENSITY_KEY) === "regular" ? "regular" : "compact",
  );

  useEffect(() => {
    localStorage.setItem(DENSITY_KEY, density);
  }, [density]);

  return [density, setDensity] as const;
}

export function DensityToggle({
  density,
  onChange,
}: {
  density: TableDensity;
  onChange: (density: TableDensity) => void;
}) {
  return (
    <div className="density-control">
      <span className="density-label">Строки таблицы</span>
      <div className="density-toggle" aria-label="Высота строк таблицы">
        <button
          data-active={density === "compact"}
          title="Меньше высота строк, больше данных на экране"
          type="button"
          onClick={() => onChange("compact")}
        >
          Больше строк
        </button>
        <button
          data-active={density === "regular"}
          title="Выше строки, легче читать длинные значения"
          type="button"
          onClick={() => onChange("regular")}
        >
          Крупнее
        </button>
      </div>
    </div>
  );
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  density,
  empty,
  getRowId,
  isLoading = false,
  onRowClick,
  pageSize = 20,
  selectedId,
}: {
  columns: AdminColumnDef<TData>[];
  data: TData[] | undefined;
  density: TableDensity;
  empty?: ReactNode;
  getRowId?: (row: TData, index: number) => string;
  isLoading?: boolean;
  onRowClick?: (row: TData) => void;
  pageSize?: number;
  selectedId?: string | null;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize });
  const rows = (data ?? EMPTY_DATA) as TData[];

  useEffect(() => {
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }, [rows.length]);

  const table = useTable(
    {
      features: adminTableFeatures,
      columns,
      data: rows,
      getRowId,
      state: { sorting, pagination },
      onSortingChange: setSorting,
      onPaginationChange: setPagination,
      enableSortingRemoval: true,
    },
    (state) => ({
      pagination: state.pagination,
      sorting: state.sorting,
    }),
  );

  const visibleRows = table.getRowModel().rows;
  const totalRows = table.getRowCount();
  const pageCount = table.getPageCount();
  const headerLabels = new Map<string, string>();

  for (const headerGroup of table.getHeaderGroups()) {
    for (const header of headerGroup.headers) {
      const label = header.column.columnDef.header;
      headerLabels.set(header.column.id, typeof label === "string" ? label : "");
    }
  }

  if (isLoading) {
    return (
      <div className="table-shell" data-loading="true">
        <div className="page-stack">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="skeleton skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  return (
    <div className="table-shell" data-density={density}>
      <table className="data-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const canSort = header.column.getCanSort();
                const align = header.column.columnDef.meta?.align;

                return (
                  <th key={header.id} data-sortable={canSort || undefined}>
                    {header.isPlaceholder ? null : (
                      <button
                        className="table-th-button"
                        data-align={align}
                        disabled={!canSort}
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span>
                          <table.FlexRender header={header} />
                        </span>
                        {canSort ? (
                          sorted === "asc" ? (
                            <ArrowUp size={12} aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDown size={12} aria-hidden />
                          ) : (
                            <ChevronsUpDown size={12} aria-hidden />
                          )
                        ) : null}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr
              key={row.id}
              data-selected={selectedId === row.id}
              onClick={(event) => {
                if (isInteractiveTarget(event.target, event.currentTarget)) return;
                onRowClick?.(row.original);
              }}
            >
              {row.getAllCells().map((cell) => (
                <td key={cell.id} data-align={cell.column.columnDef.meta?.align}>
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mobile-table-list">
        {visibleRows.map((row) => {
          const cells = row.getAllCells();
          const primaryCell = cells[0];
          const actionCells = cells.filter((cell, index) => index > 0 && !headerLabels.get(cell.column.id));
          const detailCells = cells.filter((cell, index) => index > 0 && headerLabels.get(cell.column.id));

          return (
            <div
              key={row.id}
              className="mobile-table-card"
              data-clickable={Boolean(onRowClick) || undefined}
              data-selected={selectedId === row.id}
              onClick={(event) => {
                if (isInteractiveTarget(event.target, event.currentTarget)) return;
                onRowClick?.(row.original);
              }}
              onKeyDown={(event) => {
                if (!onRowClick || isInteractiveTarget(event.target, event.currentTarget)) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onRowClick(row.original);
                }
              }}
              role={onRowClick ? "button" : undefined}
              tabIndex={onRowClick ? 0 : undefined}
            >
              <div className="mobile-table-card-head">
                <div className="mobile-table-primary">
                  {primaryCell ? <table.FlexRender cell={primaryCell} /> : null}
                </div>
                {actionCells.length > 0 ? (
                  <div className="mobile-table-actions">
                    {actionCells.map((cell) => (
                      <table.FlexRender key={cell.id} cell={cell} />
                    ))}
                  </div>
                ) : null}
              </div>

              {detailCells.length > 0 ? (
                <div className="mobile-table-fields">
                  {detailCells.map((cell) => (
                    <div key={cell.id} className="mobile-table-field">
                      <span className="mobile-table-label">{headerLabels.get(cell.column.id)}</span>
                      <div className="mobile-table-value" data-align={cell.column.columnDef.meta?.align}>
                        <table.FlexRender cell={cell} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="table-footer">
        <span>
          {totalRows === 0
            ? "Нет строк"
            : `${table.state.pagination.pageIndex * table.state.pagination.pageSize + 1}-${Math.min(
                (table.state.pagination.pageIndex + 1) * table.state.pagination.pageSize,
                totalRows,
              )} из ${totalRows}`}
        </span>
        <span className="toolbar-spacer" />
        <Select
          className="table-page-size"
          value={String(table.state.pagination.pageSize)}
          options={[10, 20, 50, 100].map((size) => ({ label: `${size} строк`, value: String(size) }))}
          onChange={(value) => table.setPageSize(Number(value))}
        />
        <Button
          disabled={!table.getCanPreviousPage()}
          size="xs"
          variant="ghost"
          onClick={() => table.previousPage()}
        >
          Назад
        </Button>
        <span className={cn("mono", "row-muted")}>
          {Math.min(table.state.pagination.pageIndex + 1, Math.max(pageCount, 1))}/{Math.max(pageCount, 1)}
        </span>
        <Button
          disabled={!table.getCanNextPage()}
          size="xs"
          variant="ghost"
          onClick={() => table.nextPage()}
        >
          Дальше
        </Button>
      </div>
    </div>
  );
}

declare module "@tanstack/react-table" {
  interface ColumnMeta<TFeatures, TData, TValue> {
    align?: "left" | "center" | "right";
  }
}
