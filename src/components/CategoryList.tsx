import React from 'react';
import { Link } from 'react-router-dom';
import { Mountain, Building, Palmtree, Umbrella as UmbrellaBeach, Bike, Landmark, Tag } from 'lucide-react';
import { useTourCategories } from '../hooks/useSharedData';

const iconMap: Record<string, React.ReactNode> = {
  'adventure': <Mountain className="h-6 w-6" />,
  'nature': <Palmtree className="h-6 w-6" />,
  'cultural': <Building className="h-6 w-6" />,
  'beach': <UmbrellaBeach className="h-6 w-6" />,
  'urban': <Building className="h-6 w-6" />,
  'wellness': <Bike className="h-6 w-6" />,
  'pueblo-magico': <Landmark className="h-6 w-6" />,
  'zona-arqueologica': <Landmark className="h-6 w-6" />,
};

const CategoryList: React.FC = () => {
  const { data: categories = [], isLoading: loading } = useTourCategories();
  const displayCategories = categories.slice(0, 8);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-4">
      {displayCategories.map((category) => (
        <Link
          key={category.id}
          to={`/tours?category=${category.slug}`}
          className="flex flex-col items-center justify-center p-4 bg-blue-100 rounded-lg shadow-sm hover:shadow-md transition-shadow group"
        >
          <div className="w-12 h-12 rounded-full bg-primary-50 flex items-center justify-center mb-2 text-primary-600 group-hover:bg-primary-100 transition-colors">
            {iconMap[category.slug] || <Tag className="h-6 w-6" />}
          </div>
          <span className="text-sm font-medium text-gray-700">{category.name}</span>
        </Link>
      ))}
    </div>
  );
};

export default CategoryList;