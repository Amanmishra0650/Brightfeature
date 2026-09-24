// Upload directly to Blob, keeping PDF bodies out of the Vercel function.
export function uploadPdf(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('Content-Type', 'application/pdf');
    request.timeout = 15 * 60 * 1000;
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(event.loaded / event.total * 100);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error('PDF upload failed. Please select the file and try again.'));
    };
    request.onerror = () => reject(new Error('PDF upload failed. Check your connection and try again.'));
    request.ontimeout = () => reject(new Error('PDF upload timed out. Please try again.'));
    request.onabort = () => reject(new Error('PDF upload was cancelled.'));
    request.send(file);
  });
}
