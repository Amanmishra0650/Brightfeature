import { useState } from 'react';
import { Modal, Field, ErrorMessage } from '../../frontend/src/components.jsx';
import { api } from '../../frontend/src/api.js';

export default function UploadNotes({ note, onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (!file) { setError('Choose a PDF to upload.'); return; }
    if (!/\.pdf$/i.test(file.name)) { setError('Choose a file with a .pdf extension.'); return; }
    if (file.size === 0) { setError('This file is empty. Choose a PDF with content.'); return; }
    if (file.size > 50 * 1024 * 1024) { setError(`This PDF is ${(file.size / 1024 / 1024).toFixed(2)} MB. The maximum allowed size is 50 MB.`); return; }
    setBusy(true); setError(''); setProgress('Starting upload…');
    try {
      const config = await api('/admin/upload-config');
      if (config.mode === 'cloud') {
        const prepared = await api(`/admin/notes/${note.id}/upload/prepare`, { method: 'POST', body: { name: file.name, size: file.size } });
        const { put } = await import('@vercel/blob/client');
        await put(prepared.pathname, file, { access: 'private', token: prepared.token, contentType: 'application/pdf', multipart: true, onUploadProgress: ({ percentage }) => setProgress(`Uploading PDF: ${Math.round(percentage)}%`) });
        setProgress('Checking PDF and generating preview…');
        onSaved(await api(`/admin/notes/${note.id}/upload/complete`, { method: 'POST', body: { pathname: prepared.pathname } }));
        return;
      }
      const response = await fetch(`/api/admin/notes/${note.id}/file`, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/pdf', 'X-File-Name': encodeURIComponent(file.name) }, body: file,
      });
      const updated = await response.json();
      if (!response.ok) throw new Error(updated.error || 'Upload failed. Please try again.');
      onSaved(updated);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title="Upload notes PDF" onClose={() => { if (!busy) onClose(); }}>
    <h3>{note.title}</h3>
    <p>Upload the study material students can download from their library after verified payment.</p>
    {note.file && <p>Current file: <a href={`/api/admin/notes/${note.id}/file`} download>{note.file.name}</a>. Uploading a new file replaces it.</p>}
    <form onSubmit={submit}>
      <Field label="Notes PDF"><input type="file" accept=".pdf,application/pdf" required disabled={busy} onChange={e => { setFile(e.target.files[0] || null); setError(''); }}/></Field>
      {file && <p className="admin-muted">Selected file: {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
      <p className="admin-muted">PDF only · Maximum 50 MB. The first two pages are used for the public preview; the full PDF requires verified payment.</p>
      <ErrorMessage message={error}/>
      <div className="admin-actions"><button className="admin-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload PDF'}</button><button type="button" className="admin-secondary" disabled={busy} onClick={onClose}>Cancel</button></div>
      {busy && <p role="status">{progress} Please keep this dialog open.</p>}
    </form>
  </Modal>;
}
