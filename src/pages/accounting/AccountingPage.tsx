import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, BarChart2, FileText, List, Download, RefreshCw,
  TrendingUp, TrendingDown, DollarSign, Layers, ChevronRight,
  Plus, AlertCircle, CheckCircle, Clock, Search, Calendar,
  BookMarked, ArrowUpRight, ArrowDownLeft, Users, Building2,
  X, ChevronDown, ChevronUp, Settings, PenLine, Trash2, Send,
  Pencil, ToggleLeft, ToggleRight, Filter, CreditCard, Gift, RotateCcw, Ban,
  ShieldCheck
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import ManualEntryModal from '../../components/accounting/ManualEntryModal';
import AccountCatalogModal from '../../components/accounting/AccountCatalogModal';
import AperturaModal from '../../components/accounting/AperturaModal';
import InsuranceSettlementModal from '../../components/accounting/InsuranceSettlementModal';
import InsuranceCommissionModal from '../../components/accounting/InsuranceCommissionModal';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChartAccount {
  id: string;
  code: string;
  sat_group_code: string;
  name: string;
  account_type: 'activo' | 'pasivo' | 'capital' | 'ingreso' | 'gasto' | 'costo';
  parent_code: string | null;
  level: number;
  nature: 'deudora' | 'acreedora';
  is_system: boolean;
  is_active: boolean;
  description: string;
}

interface TrialBalanceRow {
  code: string;
  name: string;
  sat_group_code: string;
  account_type: string;
  nature: string;
  opening_debit: number;
  opening_credit: number;
  period_debit: number;
  period_credit: number;
  closing_debit: number;
  closing_credit: number;
}

interface BalanceSheetRow {
  code: string;
  name: string;
  account_type: string;
  nature: string;
  balance: number;
}

interface IncomeStatementRow {
  code: string;
  name: string;
  account_type: string;
  total_amount: number;
}

interface AccountBalanceRow {
  code: string;
  name: string;
  account_type: string;
  nature: string;
  level: number;
  parent_code: string | null;
  is_system: boolean;
  period_debit: number;
  period_credit: number;
  period_balance: number;
  historic_debit: number;
  historic_credit: number;
  historic_balance: number;
}

interface AccountingEntry {
  id: string;
  entry_number: string;
  entry_type: 'ingreso' | 'egreso' | 'diario' | 'apertura';
  entry_date: string;
  period_year: number;
  period_month: number;
  description: string;
  source_type: string | null;
  is_posted: boolean;
  created_at: string;
}

interface EntryLine {
  id: string;
  account_code: string;
  description: string;
  debit: number;
  credit: number;
  cfdi_uuid: string | null;
}

interface InsuranceSettlement {
  id: string;
  provider_name: string;
  period_start: string;
  period_end: string;
  amount: number;
  payment_date: string | null;
  reference: string | null;
  notes: string | null;
  status: 'pending' | 'completed';
  created_at: string;
}

interface InsuranceCommissionReceipt {
  id: string;
  provider_name: string;
  period_start: string;
  period_end: string;
  amount: number;
  receipt_date: string | null;
  invoice_reference: string | null;
  cfdi_uuid: string | null;
  notes: string | null;
  status: 'pending' | 'completed';
  created_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function fmt(n: number | null | undefined): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n ?? 0);
}

function typeLabel(t: string): string {
  const m: Record<string, string> = {
    activo: 'Activo', pasivo: 'Pasivo', capital: 'Capital',
    ingreso: 'Ingreso', gasto: 'Gasto', costo: 'Costo',
  };
  return m[t] ?? t;
}

function entryTypeIcon(t: string) {
  if (t === 'ingreso') return <ArrowUpRight className="w-4 h-4 text-emerald-600" />;
  if (t === 'egreso') return <ArrowDownLeft className="w-4 h-4 text-red-500" />;
  if (t === 'apertura') return <BookOpen className="w-4 h-4 text-amber-600" />;
  return <BookMarked className="w-4 h-4 text-sky-500" />;
}

function typeColor(t: string): string {
  const m: Record<string, string> = {
    activo: 'bg-sky-50 text-sky-700 border border-sky-200',
    pasivo: 'bg-amber-50 text-amber-700 border border-amber-200',
    capital: 'bg-violet-50 text-violet-700 border border-violet-200',
    ingreso: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    gasto: 'bg-red-50 text-red-700 border border-red-200',
    costo: 'bg-orange-50 text-orange-700 border border-orange-200',
  };
  return m[t] ?? 'bg-gray-50 text-gray-700';
}

// ─── Main Component ───────────────────────────────────────────────────────────

const ALL_TABS = [
  { id: 'overview', label: 'Resumen', icon: BarChart2 },
  { id: 'entries', label: 'Polizas', icon: List },
  { id: 'libro_diario', label: 'Libro Diario', icon: BookMarked },
  { id: 'libro_mayor', label: 'Libro Mayor', icon: BookOpen },
  { id: 'manual', label: 'Movimientos', icon: PenLine },
  { id: 'seguros', label: 'Seguros de Viaje', icon: ShieldCheck },
  { id: 'balance_sheet', label: 'Balance General', icon: Layers },
  { id: 'income', label: 'Estado de Resultados', icon: TrendingUp },
  { id: 'catalog', label: 'Catalogo', icon: BookOpen },
] as const;

type Tab = typeof ALL_TABS[number]['id'];

const AccountingPage: React.FC = () => {
  const { isAdmin, isAccountant, isSuperAdmin } = useAuth();
  const canExport = isAdmin || isSuperAdmin || isAccountant;
  const canManage = isAdmin || isSuperAdmin;

  const now = new Date();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [compareYear, setCompareYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());
  const [compareMonth, setCompareMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [showCompare, setShowCompare] = useState(false);

  // Data states
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[]>([]);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetRow[]>([]);
  const [compareBalanceSheet, setCompareBalanceSheet] = useState<BalanceSheetRow[]>([]);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementRow[]>([]);
  const [compareIncome, setCompareIncome] = useState<IncomeStatementRow[]>([]);
  const [entries, setEntries] = useState<AccountingEntry[]>([]);
  const [entryLines, setEntryLines] = useState<Record<string, EntryLine[]>>({});
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const [loadingEntries, setLoadingEntries] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [searchAccounts, setSearchAccounts] = useState('');
  const [catalogTypeFilter, setCatalogTypeFilter] = useState<string>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [accountBalances, setAccountBalances] = useState<AccountBalanceRow[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [catalogModal, setCatalogModal] = useState<{ open: boolean; account: ChartAccount | null }>({ open: false, account: null });
  const [deleteConfirm, setDeleteConfirm] = useState<ChartAccount | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [entryFilter, setEntryFilter] = useState<'all' | 'ingreso' | 'egreso' | 'diario'>('all');

  // Libro Mayor
  const [selectedLedgerAccount, setSelectedLedgerAccount] = useState<string | null>(null);
  const [ledgerLines, setLedgerLines] = useState<Array<{
    entry_date: string;
    entry_number: string;
    description: string;
    debit: number;
    credit: number;
  }>>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [mayorView, setMayorView] = useState<'ledger' | 'trial'>('ledger');

  // Gift card accounting summary
  const [gcSummary, setGcSummary] = useState<{
    pending_balance: number;
    sold_count: number;
    redeemed_count: number;
    expired_count: number;
    expiration_income: number;
  } | null>(null);
  const [loadingGcSummary, setLoadingGcSummary] = useState(false);

  // Manual entries tab
  const [manualEntries, setManualEntries] = useState<AccountingEntry[]>([]);
  const [loadingManual, setLoadingManual] = useState(false);
  const [manualFilter, setManualFilter] = useState<'all' | 'ingreso' | 'egreso' | 'diario'>('all');
  const [showManualModal, setShowManualModal] = useState(false);
  const [showAperturaModal, setShowAperturaModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Insurance tab
  const [insuranceSettlements, setInsuranceSettlements] = useState<InsuranceSettlement[]>([]);
  const [insuranceCommissions, setInsuranceCommissions] = useState<InsuranceCommissionReceipt[]>([]);
  const [loadingInsurance, setLoadingInsurance] = useState(false);
  const [insuranceLiability, setInsuranceLiability] = useState(0);
  const [insuranceSpread, setInsuranceSpread] = useState(0);
  const [insuranceCommissionsTotal, setInsuranceCommissionsTotal] = useState(0);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [showCommissionModal, setShowCommissionModal] = useState(false);
  const [confirmMarkPaid, setConfirmMarkPaid] = useState<string | null>(null);
  const [confirmMarkReceived, setConfirmMarkReceived] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Accountant granular permissions (fetched when user is accountant)
  const [accountantPerms, setAccountantPerms] = useState<Record<string, boolean> | null>(null);
  const canViewSeguros = canManage || (isAccountant && accountantPerms?.can_view_seguros === true);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Load accounts
  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    const { data } = await supabase
      .from('chart_of_accounts')
      .select('*')
      .order('code');
    setAccounts(data ?? []);
    setLoadingAccounts(false);
  }, []);

  // ── Load account balances for catalog
  const loadAccountBalances = useCallback(async () => {
    setLoadingBalances(true);
    const { data } = await supabase.rpc('get_account_balances_full', { p_year: year, p_month: month });
    setAccountBalances(data ?? []);
    setLoadingBalances(false);
  }, [year, month]);

  const handleDeleteAccount = async (account: ChartAccount) => {
    setDeletingAccount(true);
    // Check for movements
    const { count } = await supabase
      .from('accounting_entry_lines')
      .select('id', { count: 'exact', head: true })
      .eq('account_code', account.code);
    if ((count ?? 0) > 0) {
      // Has movements — only deactivate
      await supabase.from('chart_of_accounts').update({ is_active: false }).eq('id', account.id);
      showToast('Cuenta desactivada (tiene movimientos registrados)');
    } else {
      await supabase.from('chart_of_accounts').delete().eq('id', account.id);
      showToast('Cuenta eliminada');
    }
    setDeleteConfirm(null);
    setDeletingAccount(false);
    loadAccounts();
    loadAccountBalances();
  };

  // ── Load entries for period (all sources including manual)
  const loadEntries = useCallback(async () => {
    setLoadingEntries(true);
    const { data } = await supabase
      .from('accounting_entries')
      .select('id, entry_number, entry_type, entry_date, period_year, period_month, description, source_type, is_posted, created_at')
      .eq('period_year', year)
      .eq('period_month', month)
      .order('entry_date', { ascending: true });
    setEntries(data ?? []);
    setLoadingEntries(false);
  }, [year, month]);

  // ── Load reports (balance, income, trial)
  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    const [tb, bs, is_, cbs, cis] = await Promise.all([
      supabase.rpc('get_trial_balance', { p_year: year, p_month: month }),
      supabase.rpc('get_balance_sheet', { p_year: year, p_month: month }),
      supabase.rpc('get_income_statement', { p_from_year: year, p_from_month: month, p_to_year: year, p_to_month: month }),
      showCompare ? supabase.rpc('get_balance_sheet', { p_year: compareYear, p_month: compareMonth }) : Promise.resolve({ data: [] }),
      showCompare ? supabase.rpc('get_income_statement', { p_from_year: compareYear, p_from_month: compareMonth, p_to_year: compareYear, p_to_month: compareMonth }) : Promise.resolve({ data: [] }),
    ]);
    setTrialBalance(tb.data ?? []);
    setBalanceSheet(bs.data ?? []);
    setIncomeStatement(is_.data ?? []);
    setCompareBalanceSheet(cbs.data ?? []);
    setCompareIncome(cis.data ?? []);
    setLoadingReports(false);
  }, [year, month, showCompare, compareYear, compareMonth]);

  // ── Load manual entries
  const loadManualEntries = useCallback(async () => {
    setLoadingManual(true);
    const { data } = await supabase
      .from('accounting_entries')
      .select('id, entry_number, entry_type, entry_date, period_year, period_month, description, source_type, is_posted, created_at')
      .eq('source_type', 'manual')
      .eq('period_year', year)
      .eq('period_month', month)
      .order('entry_date', { ascending: false });
    setManualEntries(data ?? []);
    setLoadingManual(false);
  }, [year, month]);

  // ── Load gift card accounting summary
  const loadGcSummary = useCallback(async () => {
    setLoadingGcSummary(true);
    const { data } = await supabase.rpc('get_gift_card_accounting_summary');
    setGcSummary(data ?? null);
    setLoadingGcSummary(false);
  }, []);

  // ── Load insurance data
  const loadInsuranceData = useCallback(async () => {
    setLoadingInsurance(true);
    const [settlementsRes, commissionsRes, liabilityRes, spreadRes] = await Promise.all([
      supabase
        .from('insurance_settlements')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('insurance_commission_receipts')
        .select('*')
        .order('created_at', { ascending: false }),
      // Pasivo acumulado total en 201.01 (sin filtro de periodo — es saldo corriente)
      supabase
        .from('accounting_entry_lines')
        .select('debit, credit')
        .eq('account_code', '201.01'),
      // Spread del periodo seleccionado en 401.02
      supabase
        .from('accounting_entry_lines')
        .select('debit, credit, accounting_entries!inner(period_year, period_month)')
        .eq('account_code', '401.02')
        .eq('accounting_entries.period_year', year)
        .eq('accounting_entries.period_month', month),
    ]);
    setInsuranceSettlements(settlementsRes.data ?? []);
    setInsuranceCommissions(commissionsRes.data ?? []);

    const liabilityLines = liabilityRes.data ?? [];
    setInsuranceLiability(liabilityLines.reduce((s, l) => s + (l.credit ?? 0) - (l.debit ?? 0), 0));

    const spreadLines = spreadRes.data ?? [];
    setInsuranceSpread(spreadLines.reduce((s, l) => s + (l.credit ?? 0) - (l.debit ?? 0), 0));

    // Comisiones cobradas en el periodo seleccionado
    const allCommissions = commissionsRes.data ?? [];
    const periodCommissions = allCommissions.filter(c => {
      if (c.status !== 'completed' || !c.receipt_date) return false;
      const d = new Date(c.receipt_date);
      return d.getFullYear() === year && (d.getMonth() + 1) === month;
    });
    setInsuranceCommissionsTotal(periodCommissions.reduce((s, c) => s + Number(c.amount), 0));

    setLoadingInsurance(false);
  }, [year, month]);

  // ── Load ledger lines for a specific account
  const loadLedgerLines = useCallback(async (accountCode: string) => {
    setLoadingLedger(true);
    const { data } = await supabase
      .from('accounting_entry_lines')
      .select('debit, credit, description, accounting_entries!inner(entry_number, entry_date, period_year, period_month, is_posted)')
      .eq('account_code', accountCode)
      .eq('accounting_entries.period_year', year)
      .eq('accounting_entries.period_month', month)
      .eq('accounting_entries.is_posted', true)
      .order('accounting_entries(entry_date)', { ascending: true });
    const rows = (data ?? []).map((r: any) => ({
      entry_date: r.accounting_entries.entry_date,
      entry_number: r.accounting_entries.entry_number,
      description: r.description,
      debit: r.debit ?? 0,
      credit: r.credit ?? 0,
    }));
    setLedgerLines(rows);
    setLoadingLedger(false);
  }, [year, month]);

  const handleConfirmEntry = async (id: string) => {
    setConfirmingId(id);
    const { error } = await supabase
      .from('accounting_entries')
      .update({ is_posted: true, posted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) showToast('Error al confirmar el movimiento', false);
    else { showToast('Movimiento confirmado'); loadManualEntries(); loadReports(); }
    setConfirmingId(null);
  };

  const handleDeleteEntry = async (id: string) => {
    setDeletingId(id);
    await supabase.from('accounting_entry_lines').delete().eq('entry_id', id);
    const { error } = await supabase.from('accounting_entries').delete().eq('id', id);
    if (error) showToast('Error al eliminar el movimiento', false);
    else { showToast('Movimiento eliminado'); setConfirmDeleteId(null); loadManualEntries(); }
    setDeletingId(null);
  };

  const handleMarkSettlementPaid = async (id: string) => {
    setMarkingId(id);
    const { error } = await supabase
      .from('insurance_settlements')
      .update({ status: 'completed' })
      .eq('id', id);
    setMarkingId(null);
    setConfirmMarkPaid(null);
    if (error) showToast('Error al actualizar la liquidación', false);
    else { showToast('Liquidación marcada como pagada'); loadInsuranceData(); }
  };

  const handleMarkCommissionReceived = async (id: string) => {
    setMarkingId(id);
    const { error } = await supabase
      .from('insurance_commission_receipts')
      .update({ status: 'completed' })
      .eq('id', id);
    setMarkingId(null);
    setConfirmMarkReceived(null);
    if (error) showToast('Error al actualizar la comisión', false);
    else { showToast('Comisión marcada como recibida'); loadInsuranceData(); }
  };

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (activeTab === 'entries') loadEntries();
  }, [activeTab, loadEntries]);

  useEffect(() => {
    if (activeTab === 'manual') loadManualEntries();
  }, [activeTab, loadManualEntries]);

  useEffect(() => {
    if (['overview', 'balance_sheet', 'income'].includes(activeTab)) loadReports();
  }, [activeTab, loadReports]);

  useEffect(() => {
    if (activeTab === 'catalog') loadAccountBalances();
  }, [activeTab, loadAccountBalances]);

  useEffect(() => {
    if (activeTab === 'overview') loadGcSummary();
  }, [activeTab, loadGcSummary]);

  useEffect(() => {
    if (activeTab === 'libro_diario') loadEntries();
  }, [activeTab, loadEntries]);

  useEffect(() => {
    if (activeTab === 'libro_mayor') {
      loadAccountBalances();
      loadReports();
    }
  }, [activeTab, loadAccountBalances, loadReports]);

  useEffect(() => {
    if (activeTab === 'seguros') loadInsuranceData();
  }, [activeTab, loadInsuranceData]);

  // Load accountant granular permissions on mount
  useEffect(() => {
    if (!isAccountant) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('accounting_access_invitations')
        .select('permissions')
        .eq('email', user.email)
        .eq('status', 'accepted')
        .maybeSingle();
      if (data?.permissions) setAccountantPerms(data.permissions as Record<string, boolean>);
    })();
  }, [isAccountant]);

  // ── Toggle entry detail
  const toggleEntry = async (entryId: string) => {
    if (expandedEntry === entryId) {
      setExpandedEntry(null);
      return;
    }
    setExpandedEntry(entryId);
    if (!entryLines[entryId]) {
      const { data } = await supabase
        .from('accounting_entry_lines')
        .select('*')
        .eq('entry_id', entryId)
        .order('line_number');
      setEntryLines(prev => ({ ...prev, [entryId]: data ?? [] }));
    }
  };

  // ── Generate entries batch
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-accounting-entries`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      const r = json.result;
      showToast(`Procesadas: ${r.bookings_processed} reservas, ${r.completions_processed} tours completados, ${r.payouts_processed} pagos`);
      loadEntries();
      loadReports();
    } catch (e: any) {
      showToast(e.message ?? 'Error al generar polizas', false);
    } finally {
      setGenerating(false);
    }
  };

  // ── Export SAT XML
  const handleExportSat = async () => {
    if (!canExport) return;
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-sat-xml?year=${year}&month=${month}`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ContabilidadElectronica_${year}${String(month).padStart(2,'0')}.zip`;
      a.click();
      showToast('XMLs descargados correctamente');
    } catch (e: any) {
      showToast(e.message ?? 'Error al exportar', false);
    } finally {
      setExporting(false);
    }
  };

  // ── Computed summaries for overview
  const totalIncome = incomeStatement
    .filter(r => r.account_type === 'ingreso')
    .reduce((s, r) => s + Number(r.total_amount), 0);
  const totalExpenses = incomeStatement
    .filter(r => r.account_type !== 'ingreso')
    .reduce((s, r) => s + Number(r.total_amount), 0);
  const netResult = totalIncome - totalExpenses;

  const totalAssets = balanceSheet.filter(r => r.account_type === 'activo').reduce((s, r) => s + Number(r.balance), 0);
  const totalLiabilities = balanceSheet.filter(r => r.account_type === 'pasivo').reduce((s, r) => s + Number(r.balance), 0);
  const totalCapital = balanceSheet.filter(r => r.account_type === 'capital').reduce((s, r) => s + Number(r.balance), 0);

  const filteredEntries = entryFilter === 'all' ? entries : entries.filter(e => e.entry_type === entryFilter);
  const filteredManualEntries = manualFilter === 'all' ? manualEntries : manualEntries.filter(e => e.entry_type === manualFilter);
  const filteredAccounts = accounts.filter(a => {
    if (!showInactive && !a.is_active) return false;
    if (catalogTypeFilter !== 'all' && a.account_type !== catalogTypeFilter) return false;
    if (searchAccounts && !a.code.toLowerCase().includes(searchAccounts.toLowerCase()) && !a.name.toLowerCase().includes(searchAccounts.toLowerCase())) return false;
    return true;
  });

  const balanceMap = Object.fromEntries(accountBalances.map(b => [b.code, b]));

  const yearsOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <BookOpen className="w-7 h-7 text-sky-600" />
                Contabilidad Electronica
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">ToursRed — RFC: TRG250711JWA · RESICO 626</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Period selector */}
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <Calendar className="w-4 h-4 text-gray-500" />
                <select value={month} onChange={e => setMonth(Number(e.target.value))}
                  className="text-sm bg-transparent border-none outline-none text-gray-700 font-medium">
                  {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
                <select value={year} onChange={e => setYear(Number(e.target.value))}
                  className="text-sm bg-transparent border-none outline-none text-gray-700 font-medium">
                  {yearsOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {isAdmin && (
                <button onClick={handleGenerate} disabled={generating}
                  className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white text-sm font-medium rounded-lg hover:bg-sky-700 disabled:opacity-60 transition-colors">
                  <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                  {generating ? 'Procesando...' : 'Generar polizas'}
                </button>
              )}

              {canExport && (
                <button onClick={handleExportSat} disabled={exporting}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors">
                  <Download className={`w-4 h-4 ${exporting ? 'animate-spin' : ''}`} />
                  {exporting ? 'Exportando...' : 'Exportar SAT'}
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-6 overflow-x-auto">
            {ALL_TABS.filter(tab => {
              if (tab.id === 'seguros') return canViewSeguros;
              return true;
            }).map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id as Tab)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                    active ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}>
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Manual entry modal */}
      {showManualModal && (
        <ManualEntryModal
          year={year}
          month={month}
          onClose={() => setShowManualModal(false)}
          onSaved={() => { loadManualEntries(); loadEntries(); loadReports(); showToast('Movimiento guardado correctamente'); }}
        />
      )}

      {/* Apertura modal */}
      {showAperturaModal && (
        <AperturaModal
          year={year}
          month={month}
          onClose={() => setShowAperturaModal(false)}
          onSaved={() => { loadEntries(); loadManualEntries(); loadReports(); showToast('Poliza de apertura registrada correctamente'); }}
        />
      )}

      {/* Insurance settlement modal */}
      {showSettlementModal && (
        <InsuranceSettlementModal
          suggestedAmount={insuranceLiability > 0 ? insuranceLiability : undefined}
          onClose={() => setShowSettlementModal(false)}
          onSaved={() => { loadInsuranceData(); showToast('Liquidación registrada correctamente'); }}
        />
      )}

      {/* Insurance commission modal */}
      {showCommissionModal && (
        <InsuranceCommissionModal
          onClose={() => setShowCommissionModal(false)}
          onSaved={() => { loadInsuranceData(); showToast('Comisión registrada correctamente'); }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
          toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {loadingReports ? <LoadingSpinner /> : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <SummaryCard label="Total Ingresos" value={fmt(totalIncome)} icon={<TrendingUp className="w-5 h-5 text-emerald-600" />} color="emerald" />
                  <SummaryCard label="Total Gastos" value={fmt(totalExpenses)} icon={<TrendingDown className="w-5 h-5 text-red-500" />} color="red" />
                  <SummaryCard label={netResult >= 0 ? 'Utilidad Neta' : 'Perdida Neta'} value={fmt(Math.abs(netResult))} icon={<DollarSign className={`w-5 h-5 ${netResult >= 0 ? 'text-sky-600' : 'text-red-500'}`} />} color={netResult >= 0 ? 'sky' : 'red'} />
                  <SummaryCard label="Total Activos" value={fmt(totalAssets)} icon={<Layers className="w-5 h-5 text-amber-600" />} color="amber" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Income breakdown */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-4">Ingresos del periodo</h3>
                    {incomeStatement.filter(r => r.account_type === 'ingreso').length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">Sin movimientos en este periodo</p>
                    ) : incomeStatement.filter(r => r.account_type === 'ingreso').map(r => (
                      <div key={r.code} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-gray-700">{r.name}</p>
                          <p className="text-xs text-gray-400">{r.code}</p>
                        </div>
                        <span className="text-sm font-semibold text-emerald-600">{fmt(r.total_amount)}</span>
                      </div>
                    ))}
                    {totalIncome > 0 && (
                      <div className="flex justify-between items-center pt-3 mt-1">
                        <span className="text-sm font-bold text-gray-700">Total</span>
                        <span className="text-sm font-bold text-emerald-700">{fmt(totalIncome)}</span>
                      </div>
                    )}
                  </div>

                  {/* Balance brief */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-800 mb-4">Posicion patrimonial</h3>
                    <div className="space-y-3">
                      <BsLine label="Total Activos" value={fmt(totalAssets)} positive />
                      <BsLine label="Total Pasivos" value={fmt(totalLiabilities)} />
                      <BsLine label="Capital Contable" value={fmt(totalCapital + netResult)} positive />
                      <div className="pt-2 border-t border-gray-100">
                        <BsLine label="Resultado del ejercicio" value={fmt(netResult)} positive={netResult >= 0} highlight />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Gift Cards accounting summary */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <CreditCard className="w-5 h-5 text-rose-500" />
                    <h3 className="font-semibold text-gray-800">Tarjetas de Regalo — Posicion contable</h3>
                    {loadingGcSummary && <RefreshCw className="w-3.5 h-3.5 text-gray-400 animate-spin ml-auto" />}
                  </div>
                  {gcSummary ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                      <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                        <p className="text-xs text-amber-600 font-medium mb-1">Saldo pendiente (218-12)</p>
                        <p className="text-lg font-bold text-amber-800">{fmt(gcSummary.pending_balance)}</p>
                        <p className="text-xs text-amber-500 mt-0.5">Pasivo por canjear</p>
                      </div>
                      <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <Gift className="w-3.5 h-3.5 text-emerald-600" />
                          <p className="text-xs text-emerald-600 font-medium">Vendidas</p>
                        </div>
                        <p className="text-lg font-bold text-emerald-800">{gcSummary.sold_count}</p>
                        <p className="text-xs text-emerald-500 mt-0.5">Polizas de venta</p>
                      </div>
                      <div className="bg-sky-50 border border-sky-100 rounded-lg p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <RotateCcw className="w-3.5 h-3.5 text-sky-600" />
                          <p className="text-xs text-sky-600 font-medium">Canjeadas</p>
                        </div>
                        <p className="text-lg font-bold text-sky-800">{gcSummary.redeemed_count}</p>
                        <p className="text-xs text-sky-500 mt-0.5">Canje a monedero</p>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <Ban className="w-3.5 h-3.5 text-gray-500" />
                          <p className="text-xs text-gray-500 font-medium">Vencidas</p>
                        </div>
                        <p className="text-lg font-bold text-gray-700">{gcSummary.expired_count}</p>
                        <p className="text-xs text-gray-400 mt-0.5">Procesadas por cron</p>
                      </div>
                      <div className="bg-rose-50 border border-rose-100 rounded-lg p-3">
                        <div className="flex items-center gap-1 mb-1">
                          <TrendingUp className="w-3.5 h-3.5 text-rose-600" />
                          <p className="text-xs text-rose-600 font-medium">Ingresos x venc. (4090)</p>
                        </div>
                        <p className="text-lg font-bold text-rose-800">{fmt(gcSummary.expiration_income)}</p>
                        <p className="text-xs text-rose-500 mt-0.5">Reconocido en resultados</p>
                      </div>
                    </div>
                  ) : (
                    !loadingGcSummary && (
                      <p className="text-sm text-gray-400 text-center py-6">Sin datos de tarjetas de regalo</p>
                    )
                  )}
                </div>

                {/* Recent entries */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="font-semibold text-gray-800 mb-4">Ultimas polizas del periodo</h3>
                  {entries.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Sin polizas. Usa "Generar polizas" para procesar los eventos del periodo.</p>
                  ) : entries.slice(-5).reverse().map(e => (
                    <div key={e.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      {entryTypeIcon(e.entry_type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-700 truncate">{e.description}</p>
                        <p className="text-xs text-gray-400">{e.entry_number} · {e.entry_date}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        e.entry_type === 'ingreso' ? 'bg-emerald-50 text-emerald-700' :
                        e.entry_type === 'egreso' ? 'bg-red-50 text-red-700' : e.entry_type === 'apertura' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'
                      }`}>{e.entry_type}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── ENTRIES ── */}
        {activeTab === 'entries' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex gap-2">
                {(['all', 'ingreso', 'egreso', 'diario'] as const).map(f => (
                  <button key={f} onClick={() => setEntryFilter(f)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                      entryFilter === f ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'
                    }`}>
                    {f === 'all' ? 'Todas' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <span className="text-sm text-gray-500">{filteredEntries.length} polizas</span>
            </div>

            {loadingEntries ? <LoadingSpinner /> : filteredEntries.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <FileText className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium">Sin polizas para este periodo</p>
                <p className="text-sm text-gray-400 mt-1">Usa "Generar polizas" para procesar los eventos automaticamente.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {filteredEntries.map((e, idx) => (
                  <div key={e.id} className={`${idx > 0 ? 'border-t border-gray-100' : ''}`}>
                    <button onClick={() => toggleEntry(e.id)}
                      className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors">
                      {entryTypeIcon(e.entry_type)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800">{e.entry_number}</p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{e.description}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">{e.entry_date}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          e.is_posted ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                        }`}>{e.is_posted ? 'Confirmada' : 'Borrador'}</span>
                        {expandedEntry === e.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </div>
                    </button>

                    {expandedEntry === e.id && (
                      <div className="px-5 pb-4">
                        <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-100 text-xs text-gray-500 uppercase">
                                <th className="text-left px-4 py-2">Cuenta</th>
                                <th className="text-left px-4 py-2">Descripcion</th>
                                <th className="text-right px-4 py-2">Debito</th>
                                <th className="text-right px-4 py-2">Credito</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(entryLines[e.id] ?? []).map((l, li) => (
                                <tr key={l.id} className={li % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                  <td className="px-4 py-2 font-mono text-xs text-sky-700">{l.account_code}</td>
                                  <td className="px-4 py-2 text-gray-600">{l.description}{l.cfdi_uuid && <span className="ml-2 text-xs text-gray-400 font-mono">{l.cfdi_uuid.slice(0,8)}…</span>}</td>
                                  <td className="px-4 py-2 text-right font-medium text-gray-800">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                                  <td className="px-4 py-2 text-right font-medium text-gray-800">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── LIBRO DIARIO ── */}
        {activeTab === 'libro_diario' && (
          <div className="space-y-4">
            {/* Filter + totals header */}
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex gap-2">
                {(['all','ingreso','egreso','diario'] as const).map(f => (
                  <button key={f} onClick={() => setEntryFilter(f)}
                    className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${entryFilter === f ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {f === 'all' ? 'Todas' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400">{MONTHS[month-1]} {year} — {entries.filter(e => entryFilter === 'all' || e.entry_type === entryFilter).length} polizas</p>
            </div>

            {loadingEntries ? <LoadingSpinner /> : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 w-24">Fecha</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600 w-28">Poliza</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-600">Cuenta / Concepto</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 w-32">Debe</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-600 w-32">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries
                      .filter(e => entryFilter === 'all' || e.entry_type === entryFilter)
                      .map(entry => {
                        const lines = entryLines[entry.id] ?? [];
                        const isExpanded = expandedEntry === entry.id;
                        return (
                          <React.Fragment key={entry.id}>
                            {/* Entry header row */}
                            <tr
                              className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer select-none"
                              onClick={() => toggleEntry(entry.id)}
                            >
                              <td className="px-4 py-2.5 text-gray-600 text-xs">{entry.entry_date}</td>
                              <td className="px-4 py-2.5">
                                <span className="font-mono text-xs font-medium text-sky-700">{entry.entry_number}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2">
                                  {entryTypeIcon(entry.entry_type)}
                                  <span className="font-medium text-gray-800">{entry.description}</span>
                                  {entry.source_type && entry.source_type !== 'manual' && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{entry.source_type}</span>
                                  )}
                                  {!entry.is_posted && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Borrador</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right text-gray-400 text-xs">
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
                              </td>
                              <td className="px-4 py-2.5" />
                            </tr>
                            {/* Entry lines */}
                            {isExpanded && lines.map((line, idx) => (
                              <tr key={line.id} className={`border-b border-gray-50 ${idx % 2 === 0 ? 'bg-sky-50/40' : 'bg-white'}`}>
                                <td className="px-4 py-2" />
                                <td className="px-4 py-2" />
                                <td className="px-4 py-2 pl-10">
                                  <p className="text-xs font-medium text-gray-700">{line.account_code} — {line.description}</p>
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                                  {line.debit > 0 ? fmt(line.debit) : ''}
                                </td>
                                <td className="px-4 py-2 text-right font-mono text-xs text-gray-700">
                                  {line.credit > 0 ? fmt(line.credit) : ''}
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    {entries.filter(e => entryFilter === 'all' || e.entry_type === entryFilter).length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">Sin polizas en este periodo</td></tr>
                    )}
                  </tbody>
                  {/* Totals footer from expanded lines */}
                  {(() => {
                    const visibleEntries = entries.filter(e => entryFilter === 'all' || e.entry_type === entryFilter);
                    const allLines = visibleEntries.flatMap(e => entryLines[e.id] ?? []);
                    const totalDebit = allLines.reduce((s, l) => s + (l.debit ?? 0), 0);
                    const totalCredit = allLines.reduce((s, l) => s + (l.credit ?? 0), 0);
                    if (allLines.length === 0) return null;
                    return (
                      <tfoot>
                        <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold">
                          <td colSpan={3} className="px-4 py-3 text-sm text-gray-700">Total del periodo (polizas expandidas)</td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-gray-800">{fmt(totalDebit)}</td>
                          <td className="px-4 py-3 text-right font-mono text-sm text-gray-800">{fmt(totalCredit)}</td>
                        </tr>
                        {Math.abs(totalDebit - totalCredit) > 0.01 && (
                          <tr className="bg-red-50">
                            <td colSpan={5} className="px-4 py-2 text-center text-xs text-red-600 font-medium">
                              Diferencia: {fmt(Math.abs(totalDebit - totalCredit))} — revisa las polizas marcadas
                            </td>
                          </tr>
                        )}
                      </tfoot>
                    );
                  })()}
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── LIBRO MAYOR ── */}
        {activeTab === 'libro_mayor' && (
          <div className="space-y-4">
            {/* Sub-view toggle */}
            <div className="flex gap-2">
              <button onClick={() => setMayorView('ledger')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${mayorView === 'ledger' ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                Libro Mayor
              </button>
              <button onClick={() => setMayorView('trial')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${mayorView === 'trial' ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                Balanza de Comprobacion
              </button>
            </div>

            {mayorView === 'ledger' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Account list */}
                <div className="bg-white rounded-xl border border-gray-200 p-4 lg:col-span-1">
                  <h3 className="font-semibold text-gray-800 mb-3">Cuentas con movimientos</h3>
                  <input
                    value={ledgerSearch}
                    onChange={e => setLedgerSearch(e.target.value)}
                    placeholder="Buscar cuenta..."
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg mb-3 outline-none focus:border-sky-400"
                  />
                  {(loadingBalances || loadingReports) ? <LoadingSpinner /> : (
                    <div className="space-y-1 max-h-[520px] overflow-y-auto">
                      {accountBalances
                        .filter(a => a.period_debit !== 0 || a.period_credit !== 0)
                        .filter(a => ledgerSearch === '' || a.code.includes(ledgerSearch) || a.name.toLowerCase().includes(ledgerSearch.toLowerCase()))
                        .map(a => (
                          <button
                            key={a.code}
                            onClick={() => { setSelectedLedgerAccount(a.code); loadLedgerLines(a.code); }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedLedgerAccount === a.code ? 'bg-sky-50 border border-sky-200' : 'hover:bg-gray-50'}`}
                          >
                            <div className="flex justify-between items-start gap-1">
                              <div>
                                <span className="font-mono text-xs text-gray-400">{a.code}</span>
                                <p className="font-medium text-gray-700 text-xs leading-tight">{a.name}</p>
                              </div>
                              <span className={`text-xs font-semibold whitespace-nowrap ${a.period_balance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                {fmt(Math.abs(a.period_balance))}
                              </span>
                            </div>
                          </button>
                        ))}
                      {accountBalances.filter(a => a.period_debit !== 0 || a.period_credit !== 0).length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-6">Sin movimientos en este periodo</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Ledger detail */}
                <div className="bg-white rounded-xl border border-gray-200 lg:col-span-2">
                  {!selectedLedgerAccount ? (
                    <div className="flex items-center justify-center h-64 text-sm text-gray-400">
                      Selecciona una cuenta para ver sus movimientos
                    </div>
                  ) : (
                    <>
                      <div className="px-5 py-4 border-b border-gray-100">
                        {(() => {
                          const acct = accountBalances.find(a => a.code === selectedLedgerAccount);
                          return (
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-mono text-sm text-gray-400">{selectedLedgerAccount}</p>
                                <h3 className="font-semibold text-gray-800">{acct?.name ?? ''}</h3>
                              </div>
                              <div className="flex gap-6 text-sm">
                                <div className="text-center">
                                  <p className="text-xs text-gray-400">Cargos</p>
                                  <p className="font-semibold text-gray-700">{fmt(acct?.period_debit ?? 0)}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-xs text-gray-400">Abonos</p>
                                  <p className="font-semibold text-gray-700">{fmt(acct?.period_credit ?? 0)}</p>
                                </div>
                                <div className="text-center">
                                  <p className="text-xs text-gray-400">Saldo</p>
                                  <p className={`font-bold ${(acct?.period_balance ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(Math.abs(acct?.period_balance ?? 0))}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      {loadingLedger ? <div className="p-6"><LoadingSpinner /></div> : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="text-left px-4 py-3 font-semibold text-gray-600 w-20">Fecha</th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600 w-28">Poliza</th>
                                <th className="text-left px-4 py-3 font-semibold text-gray-600">Concepto</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600 w-28">Cargo</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600 w-28">Abono</th>
                                <th className="text-right px-4 py-3 font-semibold text-gray-600 w-28">Saldo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(() => {
                                const nature = accountBalances.find(a => a.code === selectedLedgerAccount)?.nature ?? 'deudora';
                                let running = 0;
                                return ledgerLines.map((line, i) => {
                                  if (nature === 'deudora') running += line.debit - line.credit;
                                  else running += line.credit - line.debit;
                                  return (
                                    <tr key={i} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}`}>
                                      <td className="px-4 py-2.5 text-xs text-gray-500">{line.entry_date}</td>
                                      <td className="px-4 py-2.5 font-mono text-xs text-sky-700">{line.entry_number}</td>
                                      <td className="px-4 py-2.5 text-xs text-gray-700">{line.description}</td>
                                      <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-700">{line.debit > 0 ? fmt(line.debit) : ''}</td>
                                      <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-700">{line.credit > 0 ? fmt(line.credit) : ''}</td>
                                      <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${running >= 0 ? 'text-gray-800' : 'text-red-500'}`}>{fmt(Math.abs(running))}</td>
                                    </tr>
                                  );
                                });
                              })()}
                              {ledgerLines.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Sin movimientos para esta cuenta en el periodo</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {mayorView === 'trial' && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-800">Balanza de Comprobacion — {MONTHS[month-1]} {year}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Saldos de apertura + movimientos del periodo + saldos de cierre</p>
                </div>
                {loadingReports ? <div className="p-6"><LoadingSpinner /></div> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600">
                          <th className="text-left px-4 py-3">Cuenta</th>
                          <th className="text-right px-4 py-3">Apertura Debe</th>
                          <th className="text-right px-4 py-3">Apertura Haber</th>
                          <th className="text-right px-4 py-3 bg-sky-50">Periodo Debe</th>
                          <th className="text-right px-4 py-3 bg-sky-50">Periodo Haber</th>
                          <th className="text-right px-4 py-3 bg-emerald-50">Cierre Debe</th>
                          <th className="text-right px-4 py-3 bg-emerald-50">Cierre Haber</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trialBalance.map((row, i) => (
                          <tr key={row.code} className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                            <td className="px-4 py-2.5">
                              <p className="font-medium text-gray-700 text-xs">{row.name}</p>
                              <p className="font-mono text-xs text-gray-400">{row.code}</p>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600">{row.opening_debit > 0 ? fmt(row.opening_debit) : ''}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-gray-600">{row.opening_credit > 0 ? fmt(row.opening_credit) : ''}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-sky-700 bg-sky-50/30">{row.period_debit > 0 ? fmt(row.period_debit) : ''}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-sky-700 bg-sky-50/30">{row.period_credit > 0 ? fmt(row.period_credit) : ''}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-700 bg-emerald-50/30">{row.closing_debit > 0 ? fmt(row.closing_debit) : ''}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-700 bg-emerald-50/30">{row.closing_credit > 0 ? fmt(row.closing_credit) : ''}</td>
                          </tr>
                        ))}
                        {trialBalance.length === 0 && (
                          <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">Sin movimientos en este periodo</td></tr>
                        )}
                      </tbody>
                      {trialBalance.length > 0 && (
                        <tfoot>
                          <tr className="bg-gray-100 border-t-2 border-gray-300 font-semibold text-xs">
                            <td className="px-4 py-3 text-gray-700">Totales</td>
                            <td className="px-4 py-3 text-right font-mono text-gray-800">{fmt(trialBalance.reduce((s,r) => s + r.opening_debit, 0))}</td>
                            <td className="px-4 py-3 text-right font-mono text-gray-800">{fmt(trialBalance.reduce((s,r) => s + r.opening_credit, 0))}</td>
                            <td className="px-4 py-3 text-right font-mono text-sky-800 bg-sky-50">{fmt(trialBalance.reduce((s,r) => s + r.period_debit, 0))}</td>
                            <td className="px-4 py-3 text-right font-mono text-sky-800 bg-sky-50">{fmt(trialBalance.reduce((s,r) => s + r.period_credit, 0))}</td>
                            <td className="px-4 py-3 text-right font-mono text-emerald-800 bg-emerald-50">{fmt(trialBalance.reduce((s,r) => s + r.closing_debit, 0))}</td>
                            <td className="px-4 py-3 text-right font-mono text-emerald-800 bg-emerald-50">{fmt(trialBalance.reduce((s,r) => s + r.closing_credit, 0))}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── BALANCE SHEET ── */}
        {activeTab === 'balance_sheet' && (
          <div className="space-y-6">
            {/* Compare toggle */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={showCompare} onChange={e => setShowCompare(e.target.checked)}
                  className="rounded border-gray-300 text-sky-600" />
                Comparar con otro periodo
              </label>
              {showCompare && (
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                  <select value={compareMonth} onChange={e => setCompareMonth(Number(e.target.value))}
                    className="text-sm bg-transparent border-none outline-none text-gray-700">
                    {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                  </select>
                  <select value={compareYear} onChange={e => setCompareYear(Number(e.target.value))}
                    className="text-sm bg-transparent border-none outline-none text-gray-700">
                    {yearsOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              )}
            </div>

            {loadingReports ? <LoadingSpinner /> : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                  <h2 className="text-base font-bold text-gray-800">Balance General — {MONTHS[month-1]} {year}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Saldos acumulados al cierre del periodo</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase bg-gray-50">
                      <th className="text-left px-6 py-3">Cuenta</th>
                      <th className="text-left px-6 py-3">Tipo</th>
                      <th className="text-right px-6 py-3">{MONTHS[month-1]} {year}</th>
                      {showCompare && <th className="text-right px-6 py-3">{MONTHS[compareMonth-1]} {compareYear}</th>}
                      {showCompare && <th className="text-right px-6 py-3">Variacion</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(['activo','pasivo','capital'] as const).map(type => {
                      const rows = balanceSheet.filter(r => r.account_type === type);
                      if (rows.length === 0) return null;
                      const total = rows.reduce((s, r) => s + Number(r.balance), 0);
                      const cTotal = compareBalanceSheet.filter(r => r.account_type === type).reduce((s, r) => s + Number(r.balance), 0);
                      return (
                        <React.Fragment key={type}>
                          <tr className="bg-gray-50/80">
                            <td colSpan={showCompare ? 5 : 3} className="px-6 py-2">
                              <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded ${typeColor(type)}`}>{typeLabel(type)}</span>
                            </td>
                          </tr>
                          {rows.map((r, i) => {
                            const cRow = compareBalanceSheet.find(c => c.code === r.code);
                            const diff = Number(r.balance) - Number(cRow?.balance ?? 0);
                            return (
                              <tr key={r.code} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} border-b border-gray-50 hover:bg-sky-50/30 transition-colors`}>
                                <td className="px-6 py-3">
                                  <p className="font-medium text-gray-700">{r.name}</p>
                                  <p className="text-xs text-gray-400 font-mono">{r.code}</p>
                                </td>
                                <td className="px-6 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${typeColor(r.account_type)}`}>{typeLabel(r.account_type)}</span></td>
                                <td className="px-6 py-3 text-right font-semibold text-gray-800">{fmt(r.balance)}</td>
                                {showCompare && <td className="px-6 py-3 text-right text-gray-500">{cRow ? fmt(cRow.balance) : '—'}</td>}
                                {showCompare && <td className={`px-6 py-3 text-right text-xs font-medium ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{diff >= 0 ? '+' : ''}{fmt(diff)}</td>}
                              </tr>
                            );
                          })}
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <td className="px-6 py-2 font-bold text-gray-700" colSpan={2}>Total {typeLabel(type)}</td>
                            <td className="px-6 py-2 text-right font-bold text-gray-800">{fmt(total)}</td>
                            {showCompare && <td className="px-6 py-2 text-right font-semibold text-gray-500">{fmt(cTotal)}</td>}
                            {showCompare && <td className={`px-6 py-2 text-right text-sm font-bold ${total - cTotal >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{total - cTotal >= 0 ? '+' : ''}{fmt(total - cTotal)}</td>}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {balanceSheet.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-12">Sin datos para este periodo. Genera polizas primero.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── INCOME STATEMENT ── */}
        {activeTab === 'income' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={showCompare} onChange={e => setShowCompare(e.target.checked)}
                  className="rounded border-gray-300 text-sky-600" />
                Comparar con otro periodo
              </label>
              {showCompare && (
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                  <select value={compareMonth} onChange={e => setCompareMonth(Number(e.target.value))}
                    className="text-sm bg-transparent border-none outline-none text-gray-700">
                    {MONTHS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                  </select>
                  <select value={compareYear} onChange={e => setCompareYear(Number(e.target.value))}
                    className="text-sm bg-transparent border-none outline-none text-gray-700">
                    {yearsOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              )}
            </div>

            {loadingReports ? <LoadingSpinner /> : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                  <h2 className="text-base font-bold text-gray-800">Estado de Resultados — {MONTHS[month-1]} {year}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">Ingresos propios de ToursRed (comisiones + cargo de servicio)</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase bg-gray-50">
                      <th className="text-left px-6 py-3">Cuenta</th>
                      <th className="text-left px-6 py-3">Tipo</th>
                      <th className="text-right px-6 py-3">{MONTHS[month-1]} {year}</th>
                      {showCompare && <th className="text-right px-6 py-3">{MONTHS[compareMonth-1]} {compareYear}</th>}
                      {showCompare && <th className="text-right px-6 py-3">Variacion</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(['ingreso','costo','gasto'] as const).map(type => {
                      const rows = incomeStatement.filter(r => r.account_type === type);
                      if (rows.length === 0) return null;
                      const total = rows.reduce((s, r) => s + Number(r.total_amount), 0);
                      const cTotal = compareIncome.filter(r => r.account_type === type).reduce((s, r) => s + Number(r.total_amount), 0);
                      return (
                        <React.Fragment key={type}>
                          <tr className="bg-gray-50/80">
                            <td colSpan={showCompare ? 5 : 3} className="px-6 py-2">
                              <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded ${typeColor(type)}`}>{typeLabel(type)}</span>
                            </td>
                          </tr>
                          {rows.map((r, i) => {
                            const cRow = compareIncome.find(c => c.code === r.code);
                            const diff = Number(r.total_amount) - Number(cRow?.total_amount ?? 0);
                            return (
                              <tr key={r.code} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} border-b border-gray-50 hover:bg-sky-50/30 transition-colors`}>
                                <td className="px-6 py-3">
                                  <p className="font-medium text-gray-700">{r.name}</p>
                                  <p className="text-xs text-gray-400 font-mono">{r.code}</p>
                                </td>
                                <td className="px-6 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${typeColor(r.account_type)}`}>{typeLabel(r.account_type)}</span></td>
                                <td className="px-6 py-3 text-right font-semibold text-gray-800">{fmt(r.total_amount)}</td>
                                {showCompare && <td className="px-6 py-3 text-right text-gray-500">{cRow ? fmt(cRow.total_amount) : '—'}</td>}
                                {showCompare && <td className={`px-6 py-3 text-right text-xs font-medium ${diff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{diff >= 0 ? '+' : ''}{fmt(diff)}</td>}
                              </tr>
                            );
                          })}
                          <tr className="border-b border-gray-200 bg-gray-50">
                            <td className="px-6 py-2 font-bold text-gray-700" colSpan={2}>Total {typeLabel(type)}</td>
                            <td className="px-6 py-2 text-right font-bold text-gray-800">{fmt(total)}</td>
                            {showCompare && <td className="px-6 py-2 text-right font-semibold text-gray-500">{fmt(cTotal)}</td>}
                            {showCompare && <td className={`px-6 py-2 text-right text-sm font-bold ${total - cTotal >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{total - cTotal >= 0 ? '+' : ''}{fmt(total - cTotal)}</td>}
                          </tr>
                        </React.Fragment>
                      );
                    })}
                    {/* Net result row */}
                    <tr className="bg-gray-900 text-white">
                      <td className="px-6 py-4 font-bold text-base" colSpan={2}>{netResult >= 0 ? 'Utilidad Neta del Periodo' : 'Perdida Neta del Periodo'}</td>
                      <td className={`px-6 py-4 text-right font-bold text-base ${netResult >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(Math.abs(netResult))}</td>
                      {showCompare && (() => {
                        const cIn = compareIncome.filter(r => r.account_type === 'ingreso').reduce((s, r) => s + Number(r.total_amount), 0);
                        const cEx = compareIncome.filter(r => r.account_type !== 'ingreso').reduce((s, r) => s + Number(r.total_amount), 0);
                        const cNet = cIn - cEx;
                        return (
                          <>
                            <td className="px-6 py-4 text-right font-semibold text-gray-300">{fmt(Math.abs(cNet))}</td>
                            <td className={`px-6 py-4 text-right font-bold ${netResult - cNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{netResult - cNet >= 0 ? '+' : ''}{fmt(netResult - cNet)}</td>
                          </>
                        );
                      })()}
                    </tr>
                  </tbody>
                </table>
                {incomeStatement.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-12">Sin datos para este periodo.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── MANUAL ENTRIES ── */}
        {activeTab === 'manual' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {(['all', 'ingreso', 'egreso', 'diario'] as const).map(f => (
                  <button key={f} onClick={() => setManualFilter(f)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
                      manualFilter === f
                        ? f === 'ingreso' ? 'bg-emerald-600 text-white border-emerald-600'
                          : f === 'egreso' ? 'bg-red-500 text-white border-red-500'
                          : f === 'diario' ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-gray-800 text-white border-gray-800'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}>
                    {f === 'ingreso' && <ArrowUpRight className="w-3.5 h-3.5" />}
                    {f === 'egreso' && <ArrowDownLeft className="w-3.5 h-3.5" />}
                    {f === 'diario' && <BookMarked className="w-3.5 h-3.5" />}
                    {f === 'all' ? 'Todos' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">{filteredManualEntries.length} movimientos</span>
                {(isAdmin || isAccountant) && (
                  <>
                    <button
                      onClick={() => setShowAperturaModal(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors"
                    >
                      <BookOpen className="w-4 h-4" />
                      Apertura
                    </button>
                    <button
                      onClick={() => setShowManualModal(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white text-sm font-medium rounded-lg hover:bg-sky-700 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Nuevo movimiento
                    </button>
                  </>
                )}
              </div>
            </div>

            {loadingManual ? <LoadingSpinner /> : filteredManualEntries.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-16 text-center">
                <PenLine className="w-12 h-12 text-gray-200 mx-auto mb-4" />
                <p className="text-gray-500 font-semibold">Sin movimientos manuales en este periodo</p>
                <p className="text-sm text-gray-400 mt-2 mb-6">Registra ingresos por consultoria, comisiones de mayoristas, gastos operativos, viaticos y mas.</p>
                {(isAdmin || isAccountant) && (
                  <button
                    onClick={() => setShowManualModal(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-600 text-white text-sm font-medium rounded-lg hover:bg-sky-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Agregar primer movimiento
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {filteredManualEntries.map((e, idx) => (
                  <div key={e.id} className={`${idx > 0 ? 'border-t border-gray-100' : ''}`}>
                    <div className="flex items-center gap-3 px-5 py-4">
                      {/* Type icon */}
                      <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${
                        e.entry_type === 'ingreso' ? 'bg-emerald-50' :
                        e.entry_type === 'egreso' ? 'bg-red-50' : 'bg-sky-50'
                      }`}>
                        {entryTypeIcon(e.entry_type)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-800">{e.entry_number}</p>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            e.entry_type === 'ingreso' ? 'bg-emerald-50 text-emerald-700' :
                            e.entry_type === 'egreso' ? 'bg-red-50 text-red-700' : e.entry_type === 'apertura' ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700'
                          }`}>
                            {e.entry_type}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            e.is_posted ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {e.is_posted ? 'Confirmado' : 'Borrador'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{e.description}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{e.entry_date}</p>
                      </div>

                      {/* Actions */}
                      {(isAdmin || isAccountant) && (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!e.is_posted && (
                            <>
                              <button
                                onClick={() => handleConfirmEntry(e.id)}
                                disabled={confirmingId === e.id}
                                title="Confirmar movimiento"
                                className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(e.id)}
                                title="Eliminar movimiento"
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => toggleEntry(e.id)}
                            className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Ver partidas"
                          >
                            {expandedEntry === e.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Expanded lines */}
                    {expandedEntry === e.id && (
                      <div className="px-5 pb-4">
                        <div className="bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-100 text-xs text-gray-500 uppercase">
                                <th className="text-left px-4 py-2">Cuenta</th>
                                <th className="text-left px-4 py-2">Descripcion</th>
                                <th className="text-right px-4 py-2">Cargo</th>
                                <th className="text-right px-4 py-2">Abono</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(entryLines[e.id] ?? []).length === 0 ? (
                                <tr><td colSpan={4} className="px-4 py-3 text-center text-xs text-gray-400">Cargando partidas...</td></tr>
                              ) : (entryLines[e.id] ?? []).map((l, li) => (
                                <tr key={l.id} className={li % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                                  <td className="px-4 py-2 font-mono text-xs text-sky-700">{l.account_code}</td>
                                  <td className="px-4 py-2 text-gray-600 text-xs">
                                    {l.description}
                                    {l.cfdi_uuid && <span className="ml-2 text-gray-400 font-mono">{l.cfdi_uuid.slice(0,8)}…</span>}
                                  </td>
                                  <td className="px-4 py-2 text-right font-medium text-gray-800">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                                  <td className="px-4 py-2 text-right font-medium text-gray-800">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Delete confirm */}
                    {confirmDeleteId === e.id && (
                      <div className="mx-5 mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-3">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-700 flex-1">Eliminar este movimiento y sus partidas. Esta accion no se puede deshacer.</p>
                        <button
                          onClick={() => handleDeleteEntry(e.id)}
                          disabled={deletingId === e.id}
                          className="px-3 py-1.5 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                        >
                          {deletingId === e.id ? 'Eliminando...' : 'Confirmar'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-3 py-1.5 bg-white text-gray-600 text-xs font-medium rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                        >
                          Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SEGUROS DE VIAJE ── */}
        {activeTab === 'seguros' && (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500 font-medium">Pasivo con Aseguradora</span>
                  <ShieldCheck className="w-5 h-5 text-amber-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">{fmt(insuranceLiability)}</p>
                <p className="text-xs text-gray-400 mt-1">Saldo acumulado cta. 201.01</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500 font-medium">Spread del Periodo</span>
                  <TrendingUp className="w-5 h-5 text-emerald-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">{fmt(insuranceSpread)}</p>
                <p className="text-xs text-gray-400 mt-1">Ingreso cta. 401.02 — {MONTHS[month - 1]} {year}</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500 font-medium">Comisiones Recibidas</span>
                  <DollarSign className="w-5 h-5 text-sky-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">{fmt(insuranceCommissionsTotal)}</p>
                <p className="text-xs text-gray-400 mt-1">Cobradas en {MONTHS[month - 1]} {year}</p>
              </div>
              <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500 font-medium">Liquidaciones Pendientes</span>
                  <Clock className="w-5 h-5 text-rose-600" />
                </div>
                <p className="text-2xl font-bold text-gray-900">
                  {insuranceSettlements.filter(s => s.status === 'pending').length}
                </p>
                <p className="text-xs text-gray-400 mt-1">Pagos pendientes a Universal Assistance</p>
              </div>
            </div>

            {loadingInsurance ? <LoadingSpinner /> : (
              <>
                {/* Flujo B — Liquidaciones a la aseguradora */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div>
                      <h3 className="font-semibold text-gray-900">Liquidaciones a la Aseguradora</h3>
                      <p className="text-xs text-gray-400 mt-0.5">Flujo B — Pagos de ToursRed a Universal Assistance</p>
                    </div>
                    {canManage && (
                      <button
                        onClick={() => setShowSettlementModal(true)}
                        className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Registrar liquidación
                      </button>
                    )}
                  </div>
                  {insuranceSettlements.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm py-10">Sin liquidaciones registradas.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <th className="text-left px-5 py-3">Aseguradora</th>
                            <th className="text-left px-4 py-3">Periodo</th>
                            <th className="text-right px-4 py-3">Monto</th>
                            <th className="text-left px-4 py-3">Fecha pago</th>
                            <th className="text-left px-4 py-3">Referencia</th>
                            <th className="text-left px-4 py-3">Estado</th>
                            {canManage && <th className="text-right px-5 py-3">Accion</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {insuranceSettlements.map(s => (
                            <tr key={s.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-5 py-3 font-medium text-gray-800">{s.provider_name}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{s.period_start} — {s.period_end}</td>
                              <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(s.amount)}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{s.payment_date ?? '—'}</td>
                              <td className="px-4 py-3 text-gray-400 text-xs font-mono">{s.reference ?? '—'}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                  s.status === 'completed'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}>
                                  {s.status === 'completed' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                  {s.status === 'completed' ? 'Pagado' : 'Pendiente'}
                                </span>
                              </td>
                              {canManage && (
                                <td className="px-5 py-3 text-right">
                                  {s.status === 'pending' && (
                                    confirmMarkPaid === s.id ? (
                                      <div className="flex items-center justify-end gap-2">
                                        <span className="text-xs text-gray-500">Confirmar?</span>
                                        <button
                                          onClick={() => handleMarkSettlementPaid(s.id)}
                                          disabled={markingId === s.id}
                                          className="px-2 py-1 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                        >
                                          {markingId === s.id ? '...' : 'Si'}
                                        </button>
                                        <button
                                          onClick={() => setConfirmMarkPaid(null)}
                                          className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 transition-colors"
                                        >
                                          No
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setConfirmMarkPaid(s.id)}
                                        className="px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                                      >
                                        Marcar pagado
                                      </button>
                                    )
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Flujo C — Comisiones recibidas */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div>
                      <h3 className="font-semibold text-gray-900">Comisiones Recibidas de la Aseguradora</h3>
                      <p className="text-xs text-gray-400 mt-0.5">Flujo C — Ingresos recibidos de Universal Assistance</p>
                    </div>
                    {canManage && (
                      <button
                        onClick={() => setShowCommissionModal(true)}
                        className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Registrar comisión
                      </button>
                    )}
                  </div>
                  {insuranceCommissions.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm py-10">Sin comisiones registradas.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <th className="text-left px-5 py-3">Aseguradora</th>
                            <th className="text-left px-4 py-3">Periodo</th>
                            <th className="text-right px-4 py-3">Monto</th>
                            <th className="text-left px-4 py-3">Fecha recepcion</th>
                            <th className="text-left px-4 py-3">Factura</th>
                            <th className="text-left px-4 py-3">Estado</th>
                            {canManage && <th className="text-right px-5 py-3">Accion</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {insuranceCommissions.map(c => (
                            <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-5 py-3 font-medium text-gray-800">{c.provider_name}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{c.period_start} — {c.period_end}</td>
                              <td className="px-4 py-3 text-right font-semibold text-emerald-700">{fmt(c.amount)}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">{c.receipt_date ?? '—'}</td>
                              <td className="px-4 py-3 text-gray-400 text-xs">{c.invoice_reference ?? '—'}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                  c.status === 'completed'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}>
                                  {c.status === 'completed' ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                  {c.status === 'completed' ? 'Recibido' : 'Pendiente'}
                                </span>
                              </td>
                              {canManage && (
                                <td className="px-5 py-3 text-right">
                                  {c.status === 'pending' && (
                                    confirmMarkReceived === c.id ? (
                                      <div className="flex items-center justify-end gap-2">
                                        <span className="text-xs text-gray-500">Confirmar?</span>
                                        <button
                                          onClick={() => handleMarkCommissionReceived(c.id)}
                                          disabled={markingId === c.id}
                                          className="px-2 py-1 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                        >
                                          {markingId === c.id ? '...' : 'Si'}
                                        </button>
                                        <button
                                          onClick={() => setConfirmMarkReceived(null)}
                                          className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded-lg hover:bg-gray-200 transition-colors"
                                        >
                                          No
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={() => setConfirmMarkReceived(c.id)}
                                        className="px-3 py-1.5 text-xs font-medium text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                                      >
                                        Marcar recibido
                                      </button>
                                    )
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── CATALOG ── */}
        {activeTab === 'catalog' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={searchAccounts} onChange={e => setSearchAccounts(e.target.value)}
                  placeholder="Buscar por codigo o nombre..."
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-100" />
              </div>
              {/* Type filter */}
              <select
                value={catalogTypeFilter}
                onChange={e => setCatalogTypeFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-sky-400 bg-white text-gray-700"
              >
                <option value="all">Todos los tipos</option>
                <option value="activo">Activo</option>
                <option value="pasivo">Pasivo</option>
                <option value="capital">Capital</option>
                <option value="ingreso">Ingreso</option>
                <option value="gasto">Gasto</option>
                <option value="costo">Costo</option>
              </select>
              {/* Show inactive toggle */}
              <button
                onClick={() => setShowInactive(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-colors ${showInactive ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                <Filter className="w-3.5 h-3.5" />
                {showInactive ? 'Ocultando inactivas: No' : 'Mostrar inactivas'}
              </button>
              <span className="text-sm text-gray-400">{filteredAccounts.length} cuentas</span>
              <div className="ml-auto">
                <button
                  onClick={() => setCatalogModal({ open: true, account: null })}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-sky-600 rounded-lg hover:bg-sky-700 transition-colors shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  Nueva cuenta
                </button>
              </div>
            </div>

            {loadingAccounts ? <LoadingSpinner /> : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                        <th className="text-left px-4 py-3">Codigo</th>
                        <th className="text-left px-4 py-3">Nombre</th>
                        <th className="text-left px-4 py-3">Tipo</th>
                        <th className="text-left px-4 py-3">Agrupador SAT</th>
                        <th className="text-left px-4 py-3">Naturaleza</th>
                        <th className="text-right px-4 py-3">Saldo periodo</th>
                        <th className="text-right px-4 py-3">Saldo historico</th>
                        <th className="text-left px-4 py-3">Estado</th>
                        <th className="text-center px-4 py-3">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAccounts.map((a, i) => {
                        const bal = balanceMap[a.code];
                        const periodBal = bal?.period_balance ?? 0;
                        const historicBal = bal?.historic_balance ?? 0;
                        return (
                          <tr key={a.id} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} border-b border-gray-50 hover:bg-sky-50/20 transition-colors`}>
                            <td className="px-4 py-3 font-mono text-xs font-semibold text-sky-700"
                              style={{ paddingLeft: `${(a.level - 1) * 12 + 16}px` }}>{a.code}</td>
                            <td className="px-4 py-3 text-gray-700 font-medium">{a.name}</td>
                            <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${typeColor(a.account_type)}`}>{typeLabel(a.account_type)}</span></td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-400">{a.sat_group_code}</td>
                            <td className="px-4 py-3 text-xs text-gray-500 capitalize">{a.nature}</td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              {loadingBalances ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                <span className={periodBal === 0 ? 'text-gray-400' : periodBal > 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold'}>
                                  {periodBal !== 0 ? fmt(periodBal) : '—'}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              {loadingBalances ? (
                                <span className="text-gray-300">—</span>
                              ) : (
                                <span className={historicBal === 0 ? 'text-gray-400' : historicBal > 0 ? 'text-gray-800 font-semibold' : 'text-red-500 font-semibold'}>
                                  {historicBal !== 0 ? fmt(historicBal) : '—'}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${a.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                                {a.is_active ? 'Activa' : 'Inactiva'}
                              </span>
                              {a.is_system && <span className="ml-1 text-xs text-gray-400">(sistema)</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => setCatalogModal({ open: true, account: a })}
                                  className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                                  title="Editar cuenta"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                {!a.is_system && (
                                  <button
                                    onClick={() => setDeleteConfirm(a)}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title={a.is_active ? 'Desactivar o eliminar' : 'Eliminar'}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredAccounts.length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-12">Sin cuentas que coincidan.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── DELETE ACCOUNT CONFIRM ── */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-sm">Eliminar / Desactivar cuenta</h3>
                  <p className="text-xs text-gray-400 font-mono">{deleteConfirm.code} — {deleteConfirm.name}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-5">
                Si la cuenta tiene movimientos registrados, sera <strong>desactivada</strong> (no eliminada) para preservar el historial contable.
                Si no tiene movimientos, sera <strong>eliminada definitivamente</strong>.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteAccount(deleteConfirm)}
                  disabled={deletingAccount}
                  className="flex-1 px-3 py-2 text-sm font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {deletingAccount ? 'Procesando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── CATALOG MODAL ── */}
        {catalogModal.open && (
          <AccountCatalogModal
            account={catalogModal.account}
            allAccounts={accounts}
            onClose={() => setCatalogModal({ open: false, account: null })}
            onSaved={() => { loadAccounts(); loadAccountBalances(); }}
          />
        )}

      </div>
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const LoadingSpinner: React.FC = () => (
  <div className="flex items-center justify-center py-16">
    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-sky-500" />
  </div>
);

const SummaryCard: React.FC<{ label: string; value: string; icon: React.ReactNode; color: string }> = ({ label, value, icon, color }) => {
  const borders: Record<string, string> = {
    emerald: 'border-emerald-100 bg-emerald-50/40',
    red: 'border-red-100 bg-red-50/40',
    sky: 'border-sky-100 bg-sky-50/40',
    amber: 'border-amber-100 bg-amber-50/40',
  };
  return (
    <div className={`rounded-xl border p-5 ${borders[color] ?? 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
};

const BsLine: React.FC<{ label: string; value: string; positive?: boolean; highlight?: boolean }> = ({ label, value, positive, highlight }) => (
  <div className={`flex justify-between items-center ${highlight ? 'font-bold' : ''}`}>
    <span className={`text-sm ${highlight ? 'text-gray-800' : 'text-gray-600'}`}>{label}</span>
    <span className={`text-sm font-semibold ${highlight ? (positive ? 'text-emerald-600' : 'text-red-500') : 'text-gray-800'}`}>{value}</span>
  </div>
);

export default AccountingPage;
