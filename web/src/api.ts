import { FileInfo, FileDetail } from './types';

export async function fetchFiles(): Promise<FileInfo[]> {
  const res = await fetch('/api/files');
  if (!res.ok) throw new Error('Failed to fetch files');
  const data = await res.json();
  return data.files;
}

export async function fetchFileDetail(name: string): Promise<FileDetail> {
  const res = await fetch(`/api/files/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to fetch file: ${name}`);
  return res.json();
}

export function audioUrl(name: string, cardIndex: number, type: 'question' | 'answer'): string {
  return `/api/audio/${encodeURIComponent(name)}/${cardIndex}/${type}`;
}

export function slideUrl(name: string, cardIndex: number, type: 'question' | 'answer'): string {
  return `/api/slides/${encodeURIComponent(name)}/${cardIndex}/${type}`;
}
