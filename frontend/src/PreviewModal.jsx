import { useEffect, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { api, money } from './api.js';
import { Modal, ErrorMessage } from './components.jsx';

export default function PreviewModal({ note, onClose, onBuy }) {
  const [preview, setPreview] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; api(`/notes/${note.id}/preview`).then(value => { if (active) setPreview(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [note.id]);
  return <Modal title="Preview notes" onClose={onClose} wide>
    <h3>{note.title}</h3><p className="muted">Read up to three sample pages after the cover.</p>
    <div className="preview-unlock-notice" role="note"><LockKeyhole size={22} aria-hidden="true"/><div><strong>Unlock the PDF</strong><p>Complete payment to download the full PDF.</p></div></div>
    <ErrorMessage message={error}/>{!error && !preview && <p role="status">Preparing your preview…</p>}
    {preview && <div className="pdf-preview"><p>{preview.pageCount} pages · {preview.pages.length} available to preview</p>
      {preview.pages.map((src, i) => <figure key={src}><figcaption>Page {i + preview.startPage}</figcaption><img src={src} alt={`Preview page ${i + preview.startPage} of ${note.title}`} onError={() => setError('Could not load this page. Close the preview and try again.')}/></figure>)}
      {preview.pages.length === 0 && <p>No sample pages after the cover are available.</p>}
      <div className="preview-purchase"><span>Unlock the full PDF · {money(note.price)}</span><button className="button button-blue" onClick={onBuy}>Buy now</button></div>
    </div>}
  </Modal>;
}
