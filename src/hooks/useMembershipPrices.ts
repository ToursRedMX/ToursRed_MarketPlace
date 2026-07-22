import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../utils/formatCurrency';

interface MembershipPrices {
  monthlyPrice: number;
  annualPrice: number;
  monthlyPriceFormatted: string;
  annualPriceFormatted: string;
  annualMonthlyEquivalent: number;
  annualMonthlyEquivalentFormatted: string;
  annualSavings: number;
  annualSavingsFormatted: string;
  savingsPercentage: number;
}

export function useMembershipPrices() {
  const [prices, setPrices] = useState<MembershipPrices | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPrices();
  }, []);

  const fetchPrices = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('platform_settings')
        .select('membership_monthly_price, membership_annual_price')
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (!data) {
        throw new Error('No se pudo cargar la configuración de precios');
      }

      const monthlyPrice = parseFloat(data.membership_monthly_price) || 49;
      const annualPrice = parseFloat(data.membership_annual_price) || 490;
      const annualMonthlyEquivalent = annualPrice / 12;
      const annualSavings = (monthlyPrice * 12) - annualPrice;
      const savingsPercentage = ((annualSavings / (monthlyPrice * 12)) * 100);

      const priceData: MembershipPrices = {
        monthlyPrice,
        annualPrice,
        monthlyPriceFormatted: `$${monthlyPrice.toFixed(0)}`,
        annualPriceFormatted: `$${annualPrice.toFixed(0)}`,
        annualMonthlyEquivalent,
        annualMonthlyEquivalentFormatted: `$${formatCurrency(annualMonthlyEquivalent)}`,
        annualSavings,
        annualSavingsFormatted: `$${annualSavings.toFixed(0)}`,
        savingsPercentage: Math.round(savingsPercentage)
      };

      setPrices(priceData);
    } catch (err: any) {
      console.error('Error fetching membership prices:', err);
      setError(err.message || 'Error al cargar los precios');

      const defaultPrices: MembershipPrices = {
        monthlyPrice: 49,
        annualPrice: 490,
        monthlyPriceFormatted: '$49',
        annualPriceFormatted: '$490',
        annualMonthlyEquivalent: 40.83,
        annualMonthlyEquivalentFormatted: '$40.83',
        annualSavings: 98,
        annualSavingsFormatted: '$98',
        savingsPercentage: 17
      };
      setPrices(defaultPrices);
    } finally {
      setLoading(false);
    }
  };

  return { prices, loading, error, refetch: fetchPrices };
}
