import { useEffect, useState } from 'react';
import { api, money } from './api.js';
import { Modal, Field, ErrorMessage } from './components.jsx';

let checkoutScript;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript) checkoutScript = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve; script.onerror = () => { checkoutScript = null; script.remove(); reject(new Error('Unable to load Razorpay. Check your connection and try again.')); };
    document.head.appendChild(script);
  });
  return checkoutScript;
}
export default function CheckoutModal({ modal, user, setUser, onClose, onSuccess, onLogin }) {
  const checkout = modal.type === 'checkout';
  const [config, setConfig] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (checkout) api('/payments/config').then(setConfig).catch(e => setError(e.message)); }, [checkout]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    let dialog;
    try {
      let student = user;
      if (!student) { const form = new FormData(event.currentTarget); student = await api('/session', { method: 'POST', body: { name: form.get('name'), email: form.get('email') } }); setUser(student); }
      if (!checkout) { onLogin(); return; }
      const order = await api('/orders', { method: 'POST', body: { noteId: modal.note.id } });
      if (order.status === 'Paid' && order.paymentVerified) { onSuccess(order); return; }
      const payment = await api('/payments/create', { method: 'POST', body: { orderId: order.id } });
      if (payment.canDownload) { onSuccess(payment); return; }
      await loadRazorpay();
      dialog = document.querySelector('dialog[open]'); dialog?.close();
      const result = await new Promise((resolve, reject) => {
        const instance = new window.Razorpay({ key: payment.keyId, order_id: payment.gatewayOrderId, amount: payment.amount, currency: payment.currency, name: 'Bright Future Notes', description: modal.note.title, prefill: { name: student.name, email: student.email }, theme: { color: '#073b8f' }, handler: resolve, modal: { ondismiss: () => reject(new Error('Payment was not completed. Your PDF remains locked.')) } });
        instance.open();
      });
      const verified = await api('/payments/verify', { method: 'POST', body: { orderId: order.id, ...result } });
      onSuccess(verified);
    } catch (e) { if (dialog?.isConnected && !dialog.open) dialog.showModal(); setError(e.message); }
    finally { setBusy(false); }
  }
  return <Modal title={checkout ? 'Unlock your full PDF' : 'Welcome to Bright Future'} onClose={() => { if (!busy) onClose(); }}>
    {checkout && <div className="checkout-summary"><div><h3>{modal.note.title}</h3><p>The same PDF uploaded by the institute.</p></div><strong>{money(modal.note.price)}</strong></div>}
    <form onSubmit={submit}>{!user && <><Field label="Your name"><input name="name" required minLength={2} maxLength={80} autoComplete="name"/></Field><Field label="Email address"><input name="email" type="email" required maxLength={120} autoComplete="email"/></Field></>}
      <p className="notice">{checkout ? config?.mode === 'test' ? 'Razorpay test mode. Use test payment details; no real money is charged.' : 'The full PDF unlocks only after payment is confirmed by Razorpay.' : 'Your library is linked to this browser session. Keep your order ID for support.'}</p>
      {checkout && config && !config.enabled && <p className="error-message">Payments are not configured yet. Please contact the institute.</p>}
      <ErrorMessage message={error}/>
      <button className="button button-blue full-width" disabled={busy || (checkout && !config?.enabled)}>{busy ? 'Please wait…' : checkout ? `Pay ${money(modal.note.price)} with Razorpay` : 'Start student session'}</button>
    </form>
  </Modal>;
}
