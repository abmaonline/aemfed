export function normalisePath(path: string): string {
  return path
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}
