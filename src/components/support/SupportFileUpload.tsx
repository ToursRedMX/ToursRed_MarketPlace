import React, { useRef, useState } from 'react';
import { Upload, X, FileText, Image, AlertCircle } from 'lucide-react';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_FILES = 3;

export interface UploadedFile {
  file: File;
  preview?: string;
  error?: string;
}

interface Props {
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  disabled?: boolean;
}

function FileIcon({ mimeType }: { mimeType: string }) {
  if (mimeType === 'application/pdf') return <FileText className="h-8 w-8 text-red-500" />;
  return <Image className="h-8 w-8 text-blue-500" />;
}

const SupportFileUpload: React.FC<Props> = ({ files, onChange, disabled = false }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const newFiles: UploadedFile[] = [];
    Array.from(incoming).forEach(file => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        newFiles.push({ file, error: 'Tipo no permitido (solo JPG, PNG, PDF)' });
        return;
      }
      if (file.size > MAX_SIZE_BYTES) {
        newFiles.push({ file, error: 'El archivo supera el limite de 5 MB' });
        return;
      }
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      newFiles.push({ file, preview });
    });

    const combined = [...files, ...newFiles].slice(0, MAX_FILES);
    onChange(combined);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!disabled) processFiles(e.dataTransfer.files);
  };

  const removeFile = (idx: number) => {
    const updated = files.filter((_, i) => i !== idx);
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-primary-400 bg-primary-50' : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
        <p className="text-sm text-gray-600">
          Arrastra archivos aqui o <span className="text-primary-600 font-medium">haz clic para seleccionar</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">JPG, PNG, PDF — max 5 MB por archivo, hasta {MAX_FILES} archivos</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.pdf"
          className="hidden"
          disabled={disabled}
          onChange={(e) => processFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, idx) => (
            <div
              key={idx}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                f.error ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'
              }`}
            >
              {f.preview ? (
                <img src={f.preview} alt="preview" className="h-10 w-10 object-cover rounded" />
              ) : (
                <FileIcon mimeType={f.file.type} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">{f.file.name}</p>
                {f.error ? (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <AlertCircle className="h-3 w-3" />
                    {f.error}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">{(f.file.size / 1024).toFixed(0)} KB</p>
                )}
              </div>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeFile(idx)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SupportFileUpload;
