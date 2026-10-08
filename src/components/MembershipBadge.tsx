import { Crown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

interface MembershipBadgeProps {
  userId: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export default function MembershipBadge({ userId, size = 'md', showLabel = true }: MembershipBadgeProps) {
  const { data: hasActiveMembership, isPending: loading } = useQuery({
    queryKey: ['has-active-membership', userId],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .rpc('has_active_membership', { p_user_id: userId });

      if (error) {
        console.error('Error checking membership:', error);
        return false;
      }
      return data || false;
    },
  });

  if (loading || !hasActiveMembership) {
    return null;
  }

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5',
  };

  const iconSizes = {
    sm: 'h-3 w-3',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  return (
    <div className={`inline-flex items-center gap-1.5 bg-gradient-to-r from-yellow-400 to-yellow-500 text-white rounded-full font-semibold shadow-md ${sizeClasses[size]}`}>
      <Crown className={iconSizes[size]} />
      {showLabel && <span>ToursRed+</span>}
    </div>
  );
}
