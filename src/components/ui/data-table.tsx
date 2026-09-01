import { cn } from "@/lib/utils";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T, index: number) => string;
  caption?: string;
  testId?: string;
}

/** Small server-rendered table shared by the accounts/categories screens. */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  testId = "data-table",
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card shadow-sm">
      <table className="w-full min-w-[36rem] text-left text-sm" data-testid={testId}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="border-b bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th className={cn("px-4 py-3 font-medium", column.className)} key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, index) => (
            <tr className="align-middle" key={getRowKey(row, index)}>
              {columns.map((column) => (
                <td className={cn("px-4 py-3", column.className)} key={column.key}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface ResourceListProps<T> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T) => React.ReactNode;
  testId?: string;
}

/** List counterpart for narrow/mobile layouts that do not need a table. */
export function ResourceList<T>({
  items,
  getItemKey,
  renderItem,
  testId = "resource-list",
}: ResourceListProps<T>) {
  return (
    <ul className="divide-y rounded-2xl border bg-card shadow-sm" data-testid={testId}>
      {items.map((item, index) => (
        <li key={getItemKey(item, index)} className="px-4 py-4">
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}
