import { useEffect, useRef } from 'react';
import { X, GraduationCap, ArrowUpRight, BookOpen, Check } from 'lucide-react';

export function Brand({ small = false }) {
  return <a className={`brand ${small ? 'brand-small' : ''}`} href="/frontend/" aria-label="Bright Future Notes home"><img src="/logo.jpg" alt="Bright Future Institute original logo"/><span><strong>BRIGHT <em>FUTURE</em></strong><small>INSTITUTE & MEDIA SOLUTION</small></span></a>;
}
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }} aria-labelledby="modal-title"><header className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={22}/></button></header>{children}</dialog>;
}
export function BookCover({ category = 'CTET', variant = 0, hero = false }) {
  return <div className={`book-cover cover-${variant % 5} ${hero ? 'hero-book' : ''}`} aria-hidden="true"><div className="cover-top"><GraduationCap size={hero ? 23 : 16}/><span>BRIGHT FUTURE<small>LEARN TODAY. LEAD TOMORROW.</small></span></div><div className="cover-body"><span className="cover-edition">COMPLETE PREPARATION GUIDE</span><strong>{category === 'Bihar Police SI' ? <>BIHAR<br/>POLICE SI</> : category === 'BPSC TRE 4.0' ? <>BPSC<br/>TRE 4.0</> : category}<i>2026</i></strong><div className="cover-line"/><p>One goal.<br/>A brighter future.</p></div><div className="cover-bottom"><span>NOTES + PYQ + PRACTICE</span><ArrowUpRight size={22}/></div><div className="cover-rings"/></div>;
}
export function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
export function ErrorMessage({ message }) { return message ? <div className="error-message" role="alert">{message}</div> : null; }
export function Empty({ title, children }) { return <div className="empty"><BookOpen size={36}/><h3>{title}</h3><p>{children}</p></div>; }
export function Toast({ message }) { return message ? <div className="toast" role="status"><Check size={19}/>{message}</div> : null; }
