export function activeSale(settings, now = Date.now()) {
  if (settings?.saleEnabled !== true || !Number.isInteger(settings.discount) || settings.discount < 1 || settings.discount > 90) return null;
  const start = Date.parse(settings.saleStartsAt);
  const end = Date.parse(settings.saleEndsAt);
  return start <= now && now < end ? { discount: settings.discount, end, scope: settings.saleScope } : null;
}

export function notePrice(note, sale) {
  if (!sale || !(note.hasFile || note.file) || (sale.scope !== 'all' && note.saleEligible !== true)) return note.price;
  return Math.min(note.price, Math.max(1, Math.floor(note.originalPrice * (100 - sale.discount) / 100)));
}

export function toIstInput(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 330 * 60000).toISOString().slice(0, 16) : '';
}
