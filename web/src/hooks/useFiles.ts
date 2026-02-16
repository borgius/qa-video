import { useState, useEffect } from 'react';
import { FileInfo, FileDetail } from '../types';
import { fetchFiles, fetchFileDetail } from '../api';

export function useFiles() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFiles()
      .then(setFiles)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return { files, loading, error };
}

export function useFileDetail(name: string | null) {
  const [data, setData] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchFileDetail(name)
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [name]);

  return { data, loading, error };
}
