/** Format a widget label for display. Probe intent: do not change signature or return shape. */
export function formatWidget(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "Widget";
  }
  return `Widget: ${trimmed}`;
}
