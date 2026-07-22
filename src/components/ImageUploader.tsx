import React, { useState, useRef } from 'react';
import { Upload, X, Image as ImageIcon, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ImageUploaderProps {
  onImageSelect: (publicUrl: string, type: string, size: number) => void;
  currentImage?: string;
  maxSizeMB?: number;
  acceptedTypes?: string[];
  className?: string;
  placeholder?: string;
  storageFolder?: string;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
  onImageSelect,
  currentImage,
  maxSizeMB = 5,
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'],
  className = '',
  placeholder = 'Seleccionar imagen',
  storageFolder = 'tours',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(currentImage || null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const validateFile = (file: File): string | null => {
    if (!acceptedTypes.includes(file.type)) {
      return `Tipo de archivo no permitido. Solo se permiten: ${acceptedTypes.join(', ')}`;
    }

    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return `El archivo es demasiado grande. Máximo ${maxSizeMB}MB permitido. Tamaño actual: ${formatFileSize(file.size)}`;
    }

    return null;
  };

  const processFile = async (file: File) => {
    setIsUploading(true);
    setError('');

    try {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      const fileExt = file.name.split('.').pop() || 'jpg';
      const fileName = `${storageFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('images')
        .getPublicUrl(fileName);

      if (!urlData?.publicUrl) {
        throw new Error('No se pudo obtener la URL pública de la imagen');
      }

      setPreview(urlData.publicUrl);
      onImageSelect(urlData.publicUrl, file.type, file.size);
    } catch (err: any) {
      setError(err.message || 'Error al subir la imagen');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemove = () => {
    setPreview(null);
    setError('');
    onImageSelect('', '', 0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          isDragging
            ? 'border-primary-500 bg-primary-50'
            : preview
            ? 'border-green-300 bg-green-50'
            : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptedTypes.join(',')}
          onChange={handleFileSelect}
          className="hidden"
        />

        {isUploading ? (
          <div className="flex flex-col items-center">
            <Loader2 className="h-8 w-8 text-primary-600 mb-2 animate-spin" />
            <p className="text-sm text-gray-600">Subiendo imagen...</p>
          </div>
        ) : preview ? (
          <div className="space-y-3">
            <div className="relative inline-block">
              <img
                src={preview}
                alt="Vista previa"
                className="max-h-32 max-w-full rounded-lg shadow-sm"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove();
                }}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-green-600 font-medium">
              Imagen cargada correctamente
            </p>
            <p className="text-xs text-gray-500">
              Haz clic para cambiar la imagen
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <Upload className="h-8 w-8 text-gray-400 mx-auto" />
            <div>
              <p className="text-sm font-medium text-gray-700">{placeholder}</p>
              <p className="text-xs text-gray-500">
                Arrastra una imagen aquí o haz clic para seleccionar
              </p>
            </div>
            <div className="text-xs text-gray-400">
              <p>Formatos: {acceptedTypes.map(type => type.split('/')[1].toUpperCase()).join(', ')}</p>
              <p>Tamaño máximo: {maxSizeMB}MB</p>
            </div>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-md">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">Error al cargar imagen</p>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="text-xs text-gray-500 space-y-1">
        <p><strong>Consejos:</strong></p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Usa imágenes de alta calidad para mejor presentación</li>
          <li>Formatos recomendados: JPEG para fotos, PNG para gráficos</li>
          <li>Comprime las imágenes antes de subirlas para mejor rendimiento</li>
        </ul>
      </div>
    </div>
  );
};

export default ImageUploader;
