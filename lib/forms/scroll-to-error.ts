/**
 * Après l'échec d'un submit, scrolle vers le premier champ en erreur et
 * lui donne le focus. À appeler depuis `onSubmit` après `setErrors(...)`.
 */
export function scrollToFirstError(
  fieldErrors: Record<string, string[] | undefined> | undefined,
): void {
  if (!fieldErrors) return;
  const firstKey = Object.keys(fieldErrors).find((k) => {
    const v = fieldErrors[k];
    return Array.isArray(v) && v.length > 0;
  });
  if (!firstKey) return;
  if (typeof window === "undefined") return;
  requestAnimationFrame(() => {
    const el = document.getElementById(firstKey);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof (el as HTMLElement).focus === "function") {
      try {
        (el as HTMLElement).focus({ preventScroll: true });
      } catch {
        (el as HTMLElement).focus();
      }
    }
  });
}
