import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered, CornerDownLeft, Link2, Link2Off, ImagePlus, Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

const ImageExtension = Node.create({
  name: 'image',
  group: 'block',
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)];
  },
  addCommands() {
    return {
      setImage: (options: { src: string; alt?: string; title?: string }) => ({ commands }: any) => {
        return commands.insertContent({ type: this.name, attrs: options });
      },
    } as any;
  },
});

interface RichTextEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  enableImages?: boolean;
  minHeight?: string;
  className?: string;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value = '',
  onChange,
  placeholder = 'Escribe aqui...',
  enableImages = true,
  minHeight = 'min-h-96',
  className = '',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      ...(enableImages ? [ImageExtension] : []),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && value !== undefined && value !== editor.getHTML()) {
      editor.commands.setContent(value, false);
    }
  }, [value, editor]);

  if (!editor) return null;

  const openLinkModal = () => {
    const existing = editor.getAttributes('link').href || '';
    setLinkUrl(existing);
    setLinkModalOpen(true);
  };

  const confirmLink = () => {
    if (linkUrl.trim()) {
      editor.chain().focus().setLink({ href: linkUrl.trim() }).run();
    }
    setLinkModalOpen(false);
    setLinkUrl('');
  };

  const cancelLink = () => {
    setLinkModalOpen(false);
    setLinkUrl('');
  };

  const btn = (
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
    label: string
  ) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`px-2 py-1 rounded text-sm font-medium transition-colors ${
        active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {icon}
    </button>
  );

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen no puede pesar mas de 5MB.');
      e.target.value = '';
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      alert('Formato no soportado. Usa JPG, PNG, WebP o GIF.');
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `newsletter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(fileName, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('images')
        .getPublicUrl(fileName);

      if (urlData?.publicUrl) {
        editor.chain().focus().setImage({ src: urlData.publicUrl, alt: file.name }).run();
      }
    } catch (err: any) {
      alert('Error al subir la imagen: ' + (err.message || 'intenta de nuevo'));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <>
      <div className={`border border-gray-300 rounded-lg overflow-hidden ${className}`}>
        <div className="flex flex-wrap gap-1 p-2 border-b border-gray-200 bg-gray-50 rounded-t-lg">
          {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold className="h-4 w-4" />, 'Negrita')}
          {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic className="h-4 w-4" />, 'Italica')}
          {btn(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <Heading1 className="h-4 w-4" />, 'Titulo 1')}
          {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 className="h-4 w-4" />, 'Titulo 2')}
          {btn(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), <Heading3 className="h-4 w-4" />, 'Titulo 3')}
          {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List className="h-4 w-4" />, 'Lista vinetas')}
          {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered className="h-4 w-4" />, 'Lista numerada')}
          {btn(false, () => editor.chain().focus().setHardBreak().run(), <CornerDownLeft className="h-4 w-4" />, 'Salto de linea')}
          {btn(editor.isActive('link'), openLinkModal, <Link2 className="h-4 w-4" />, 'Agregar link')}
          {btn(false, () => editor.chain().focus().unsetLink().run(), <Link2Off className="h-4 w-4" />, 'Quitar link')}

          {enableImages && (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                title="Insertar imagen"
                className="px-2 py-1 rounded text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleImageUpload}
                className="hidden"
              />
            </>
          )}
        </div>

        <EditorContent
          editor={editor}
          className={`tiptap ${minHeight} max-h-[500px] overflow-y-auto p-4 text-sm prose prose-sm max-w-none focus:outline-none`}
        />

        {enableImages && (
          <div className="px-3 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-400">
            Las imagenes se suben al almacenamiento de ToursRed y se muestran en el correo.
          </div>
        )}
      </div>

      {linkModalOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
          onMouseDown={(e) => { if (e.target === e.currentTarget) cancelLink(); }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-800">Insertar enlace</h3>
              <button type="button" onClick={cancelLink} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="block text-sm text-gray-600 mb-1">URL del enlace</label>
            <input
              type="url"
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); confirmLink(); }
                if (e.key === 'Escape') cancelLink();
              }}
              placeholder="https://ejemplo.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={cancelLink}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmLink}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Insertar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RichTextEditor;
