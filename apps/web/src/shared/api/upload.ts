import { apiFetch } from './client';
import type { components } from './generated';

type Schema = components['schemas'];

export async function uploadMedia(file: File, token: string): Promise<string> {
  const headers = { 'X-CSRF-Token': token };
  const upload = await apiFetch<Schema['UploadReservation']>('/files/uploads', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    }),
  });
  const response = await fetch(upload.upload_path, {
    method: 'PUT',
    credentials: 'same-origin',
    body: file,
    headers: { ...headers, 'Content-Type': file.type },
  });
  if (!response.ok) throw new Error('媒体上传失败，请检查文件后重试。');
  const ready = await apiFetch<Schema['MediaFile']>(
    `/files/${encodeURIComponent(upload.id)}/complete`,
    {
      method: 'POST',
      headers,
    },
  );
  return ready.id;
}
