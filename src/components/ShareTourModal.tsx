import React, { useState } from 'react';
import { X, Link as LinkIcon, Mail, Facebook, MessageCircle, Check } from 'lucide-react';

interface ShareTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  tourId: string;
  tourName: string;
  tourImage?: string;
}

export default function ShareTourModal({ isOpen, onClose, tourId, tourName, tourImage }: ShareTourModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const tourUrl = `${window.location.origin}/tours/${tourId}`;
  const encodedUrl = encodeURIComponent(tourUrl);
  const encodedTitle = encodeURIComponent(tourName);
  const shareMessage = encodeURIComponent(`¡Mira este tour increíble! ${tourName}`);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(tourUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Error al copiar:', err);
    }
  };

  const handleEmailShare = () => {
    const subject = encodeURIComponent(`Te comparto este tour: ${tourName}`);
    const body = encodeURIComponent(`Hola,\n\nEncontré este tour que te puede interesar:\n\n${tourName}\n\nMira más detalles aquí: ${tourUrl}\n\n¡Saludos!`);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  const handleFacebookShare = () => {
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
      '_blank',
      'width=600,height=400'
    );
  };

  const handleWhatsAppShare = () => {
    window.open(
      `https://wa.me/?text=${shareMessage}%20${encodedUrl}`,
      '_blank'
    );
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />

        <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6 z-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Compartir este tour</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-gray-500" />
            </button>
          </div>

          {tourImage && (
            <div className="mb-6">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <img
                  src={tourImage}
                  alt={tourName}
                  className="w-16 h-16 object-cover rounded-lg"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{tourName}</p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleCopyLink}
              className="w-full flex items-center gap-4 p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                {copied ? (
                  <Check className="w-6 h-6 text-green-600" />
                ) : (
                  <LinkIcon className="w-6 h-6 text-gray-700" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">
                  {copied ? 'Enlace copiado' : 'Copiar enlace'}
                </p>
                {!copied && (
                  <p className="text-sm text-gray-500">Copia el enlace para compartir</p>
                )}
              </div>
            </button>

            <button
              onClick={handleEmailShare}
              className="w-full flex items-center gap-4 p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                <Mail className="w-6 h-6 text-gray-700" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">Email</p>
                <p className="text-sm text-gray-500">Enviar por correo electrónico</p>
              </div>
            </button>

            <button
              onClick={handleFacebookShare}
              className="w-full flex items-center gap-4 p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
                <Facebook className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">Facebook</p>
                <p className="text-sm text-gray-500">Compartir en Facebook</p>
              </div>
            </button>

            <button
              onClick={handleWhatsAppShare}
              className="w-full flex items-center gap-4 p-4 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                <MessageCircle className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">WhatsApp</p>
                <p className="text-sm text-gray-500">Compartir por WhatsApp</p>
              </div>
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              Comparte este tour con tus amigos y familiares
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
