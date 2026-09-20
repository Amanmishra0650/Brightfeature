export async function api(path, options = {}) {
  const response = await fetch('/api' + path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Unable to complete your request.'), { status: response.status });
  return data;
}
export const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
export const categories = ['PET', 'CTET', 'STET', 'BPSC TRE 4.0', 'Bihar Police SI'];
export const whatsapp = message => `https://wa.me/919161868600${message ? '?text=' + encodeURIComponent(message) : ''}`;
