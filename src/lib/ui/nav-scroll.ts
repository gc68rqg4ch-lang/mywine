// Reiterzeile auf schmalen Bildschirmen (seitlich wischbar): den aktiven Reiter beim Laden
// sichtbar machen – mittig, soweit möglich (rein, für Tests).

/** scrollLeft, damit der Reiter (offsetLeft/Breite) im Container sichtbar und möglichst mittig ist. */
export function navScrollLeft(item: { left: number; width: number }, container: { width: number; scrollWidth: number }) {
  const max = Math.max(0, container.scrollWidth - container.width);
  if (max === 0) return 0;
  const target = item.left - (container.width - item.width) / 2;
  return Math.round(Math.min(max, Math.max(0, target)));
}
