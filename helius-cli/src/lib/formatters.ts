import chalk from "chalk";

const LAMPORTS_PER_SOL = 1_000_000_000;

export function formatSol(lamports: number | bigint): string {
  const num = typeof lamports === "bigint" ? Number(lamports) : lamports;
  return (num / LAMPORTS_PER_SOL).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 9,
  }) + " SOL";
}

export function formatAddress(addr: string, truncate = true): string {
  if (!truncate || addr.length <= 12) return addr;
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

export function formatTimestamp(unix: number): string {
  if (!unix) return "N/A";
  return new Date(unix * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function formatTokenAmount(amount: number | string, decimals: number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  const value = num / Math.pow(10, decimals);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export interface TableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  width?: number;
  format?: (value: any) => string;
}

export function formatTable(rows: Record<string, any>[], columns: TableColumn[]): string {
  if (rows.length === 0) return "  (no results)";

  // Calculate column widths
  const widths = columns.map((col) => {
    const headerLen = col.label.length;
    const maxDataLen = rows.reduce((max, row) => {
      const val = col.format ? col.format(row[col.key]) : String(row[col.key] ?? "");
      return Math.max(max, val.length);
    }, 0);
    return col.width || Math.max(headerLen, maxDataLen);
  });

  // Header
  const header = columns
    .map((col, i) => chalk.bold(col.label.padEnd(widths[i])))
    .join("  ");

  // Separator
  const sep = widths.map((w) => "─".repeat(w)).join("──");

  // Rows
  const body = rows.map((row) =>
    columns
      .map((col, i) => {
        const val = col.format ? col.format(row[col.key]) : String(row[col.key] ?? "");
        return col.align === "right" ? val.padStart(widths[i]) : val.padEnd(widths[i]);
      })
      .join("  ")
  );

  return [header, sep, ...body].join("\n");
}
