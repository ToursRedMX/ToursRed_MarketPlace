import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';

interface RedirectBannerProps {
  message: string | null;
  onDismiss: () => void;
}

const RedirectBanner: React.FC<RedirectBannerProps> = ({ message, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(onDismiss, 300);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      className={`transition-all duration-300 overflow-hidden ${
        visible ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'
      }`}
    >
      <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0" />
        <p className="text-sm text-blue-800 font-medium">{message}</p>
      </div>
    </div>
  );
};

export default RedirectBanner;
