import { useSEO } from '../hooks/useSEO';

interface SeoProps {
  title: string;
  description?: string;
  image?: string;
  type?: 'website' | 'product' | 'profile' | 'article';
  noindex?: boolean;
  jsonLd?: object | object[];
}

const Seo: React.FC<SeoProps> = (props) => {
  useSEO(props);
  return null;
};

export default Seo;
