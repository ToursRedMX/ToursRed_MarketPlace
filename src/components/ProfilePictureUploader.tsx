import React, { useState, useRef } from 'react';
import { Camera, Loader2, X, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ProfilePictureUploaderProps {
  currentImage?: string;
  onImageChange: (url: string) => void;
  userId: string;
}

const ProfilePictureUploader: React.FC<ProfilePictureUploaderProps> = ({
  currentImage,
  onImageChange,
  userId
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setSuccess(false);

    if (!file.type.startsWith('image/')) {
      setError('Solo se permiten archivos de imagen');
      setTimeout(() => setError(''), 5000);
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('La imagen debe ser menor a 5MB');
      setTimeout(() => setError(''), 5000);
      return;
    }

    try {
      setIsUploading(true);

      const fileExt = file.name.split('.').pop();
      const fileName = `${userId}-${Date.now()}.${fileExt}`;
      const filePath = `profile-pictures/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('images')
        .getPublicUrl(filePath);

      onImageChange(publicUrl);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error uploading image:', err);
      setError(err.message || 'Error al subir la imagen');
      setTimeout(() => setError(''), 5000);
    } finally {
      setIsUploading(false);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
      />

      <button
        onClick={handleClick}
        disabled={isUploading}
        className="text-white p-2 hover:bg-white/20 rounded-full transition-colors disabled:opacity-50"
        title="Cambiar foto de perfil"
        type="button"
      >
        {isUploading ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : (
          <Camera className="h-6 w-6" />
        )}
      </button>

      {(error || success) && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-[9999] animate-fade-in">
          {error && (
            <div className="bg-red-500 text-white px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3 min-w-[300px] border-2 border-red-600">
              <div className="flex-shrink-0 bg-white rounded-full p-1">
                <X className="h-5 w-5 text-red-500" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Error</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}
          {success && (
            <div className="bg-green-500 text-white px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3 min-w-[300px] border-2 border-green-600">
              <div className="flex-shrink-0 bg-white rounded-full p-1">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Éxito</p>
                <p className="text-sm">Foto actualizada correctamente</p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default ProfilePictureUploader;
