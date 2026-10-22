export const ARCHIVE_NEVER = "never";

export const ARCHIVE_AFTER = [
  { value: "12", title: "12 hours" },
  { value: "24", title: "24 hours" },
  { value: "168", title: "7 days" },
  { value: "720", title: "30 days" },
  { value: ARCHIVE_NEVER, title: "Never" },
];

export const archiveAfterValue = (hours: number | null) => (hours === null ? ARCHIVE_NEVER : String(hours));

export const archiveAfterHours = (value: string): number | null => (value === ARCHIVE_NEVER ? null : Number(value));

export function archiveAfterLabel(hours: number | null): string {
  if (hours === null) return "Tabs aren't archived automatically";
  const option = ARCHIVE_AFTER.find((o) => o.value === String(hours));
  return `Unpinned tabs are archived after ${option ? option.title : `${hours} hours`} without use`;
}
