export function isSelectPickerOpen(target: EventTarget | null): boolean {
  const select = target instanceof Element ? target.closest('select') : null;
  return Boolean(select && globalThis.CSS?.supports?.('selector(:open)') && select.matches(':open'));
}
