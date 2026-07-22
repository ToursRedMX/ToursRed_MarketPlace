import React, { useState, useEffect } from 'react';
import { Mail, Phone, MapPin, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { usePreventUnload } from '../hooks/usePreventUnload';
import Seo from '../components/Seo';

const ContactPage: React.FC = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' });

  const contactFormPersistence = useFormPersistence(
    formData,
    { key: 'contact_form', expirationHours: 24 }
  );

  usePreventUnload(formData.name.length > 0 || formData.email.length > 0 || formData.message.length > 0);

  useEffect(() => {
    const savedData = contactFormPersistence.loadFromStorage();
    if (savedData) {
      contactFormPersistence.setIsRestoring(true);
      setFormData(savedData);
      setTimeout(() => contactFormPersistence.setIsRestoring(false), 100);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus({ type: null, message: '' });

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/send-contact-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        contactFormPersistence.clearStorage();
        setSubmitStatus({
          type: 'success',
          message: 'Tu mensaje ha sido enviado correctamente. Nos pondremos en contacto contigo pronto.',
        });
        setFormData({ name: '', email: '', message: '' });
      } else {
        throw new Error(data.error || 'Error al enviar el mensaje');
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      setSubmitStatus({
        type: 'error',
        message: 'Hubo un error al enviar tu mensaje. Por favor, intenta nuevamente.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <Seo
        title="Contáctanos | ToursRed"
        description="¿Tienes preguntas? Contáctanos en ToursRed. Escríbenos por correo, teléfono o WhatsApp y te ayudaremos con tus tours y reservas."
        type="website"
      />
      <h1 className="text-4xl font-bold text-gray-900 mb-6">Contáctanos</h1>
      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">Envíanos un Mensaje</h2>

          {submitStatus.type && (
            <div
              className={`mb-4 p-4 rounded-md flex items-start space-x-3 ${
                submitStatus.type === 'success'
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {submitStatus.type === 'success' ? (
                <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              )}
              <p className="text-sm">{submitStatus.message}</p>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">Nombre</label>
              <input
                type="text"
                id="name"
                value={formData.name}
                onChange={handleChange}
                required
                disabled={isSubmitting}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:ring-primary-500 disabled:bg-gray-100"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">Correo Electrónico</label>
              <input
                type="email"
                id="email"
                value={formData.email}
                onChange={handleChange}
                required
                disabled={isSubmitting}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:ring-primary-500 disabled:bg-gray-100"
              />
            </div>
            <div>
              <label htmlFor="message" className="block text-sm font-medium text-gray-700">Mensaje</label>
              <textarea
                id="message"
                rows={4}
                value={formData.message}
                onChange={handleChange}
                required
                disabled={isSubmitting}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-primary-500 focus:ring-primary-500 disabled:bg-gray-100"
              ></textarea>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary-600 text-white py-2 px-4 rounded-md hover:bg-primary-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isSubmitting ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  <span>Enviando...</span>
                </>
              ) : (
                <span>Enviar Mensaje</span>
              )}
            </button>
          </form>
        </div>
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Información de Contacto</h2>
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <Mail className="w-5 h-5 text-primary-600" />
                <span className="text-gray-600">contacto@toursred.com</span>
              </div>
              <div className="flex items-center space-x-3">
                <Phone className="w-5 h-5 text-primary-600" />
                <a
                  href="https://wa.me/525547127668"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:text-primary-600 transition-colors"
                >
                  +52 55 47127668
                </a>
              </div>
              <div className="flex items-center space-x-3">
                <MapPin className="w-5 h-5 text-primary-600" />
                <span className="text-gray-600">Av. Homero 229-501, Polanco</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContactPage;