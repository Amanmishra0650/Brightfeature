import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { api, money } from './api.js';
import { Modal, ErrorMessage } from './components.jsx';

export default function PreviewModal({ note, onClose, onBuy }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; api(`/notes/${note.id}/preview`).then(value => { if (active) setPreview(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [note.id]);
  return <Modal title="Preview notes" onClose={onClose} wide>
    <h3>{note.title}</h3><p className="muted">Read the first two pages. Complete payment to download the full uploaded PDF.</p>
    <ErrorMessage message={error}/>{!error && !preview && <p role="status">Preparing your preview…</p>}
    {preview && <div className="pdf-preview"><p>{preview.pageCount} pages · {preview.pages.length} available to preview</p>
      {preview.pages.map((src, i) => <figure key={src}><figcaption>Page {i + 1}</figcaption><img src={src} alt={`Preview page ${i + 1} of ${note.title}`} onError={() => setError('Could not load this page. Close the preview and try again.')}/></figure>)}
      {preview.pageCount > 2 && <div className="locked-pages"><div className="blurred-page" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <div key={i} style={{ width: `${60 + i % 4 * 10}%` }}/>)}</div><div className="preview-lock"><LockKeyhole size={32}/><h3>Pages 3–{preview.pageCount} are locked</h3><p>Unlock all {preview.pageCount} pages after payment.</p></div></div>}
      <div className="preview-purchase"><span>Full PDF · {money(note.price)}</span><button className="button button-blue" onClick={onBuy}>Buy now</button></div>
    </div>}
  </Modal>;
}
