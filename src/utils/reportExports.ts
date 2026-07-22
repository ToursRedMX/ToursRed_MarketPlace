import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';
import { formatCurrencyMXN } from './formatCurrency';

interface TravelerData {
  id: string;
  nombre: string;
  email: string;
  telefono?: string;
  categoria_viajero: string;
  fecha_nacimiento?: string;
  precio_aplicado: number;
}

interface BookingData {
  id: string;
  deposit_amount: number;
  total_price: number;
  user_payment: number;
  payment_method?: string;
  booking_date: string;
  created_at: string;
  toursred_cash_used?: number;
  users: {
    first_name: string;
    last_name: string;
    email: string;
    phone_number?: string;
  };
  travelers: TravelerData[];
}

interface TourReportData {
  tour: {
    name: string;
    destination: string;
    start_date: string;
    end_date: string;
  };
  bookings: BookingData[];
  summary: {
    totalBookings: number;
    totalTravelers: number;
    totalsByCategory: {
      adultos: number;
      ninos: number;
      infantes: number;
      adultos_mayores: number;
      mascotas: number;
    };
    totalDeposit: number;
    totalRemaining: number;
    totalRevenue: number;
  };
}

const getCategoryLabel = (categoria: string): string => {
  const labels: Record<string, string> = {
    adulto: 'Adulto',
    nino: 'Niño',
    infante: 'Infante',
    adulto_mayor: 'Adulto Mayor',
    mascota: 'Mascota',
  };
  return labels[categoria] || categoria;
};

const formatCurrency = (amount: number): string => formatCurrencyMXN(amount);

const formatDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    return format(date, 'dd/MM/yyyy');
  } catch {
    return dateString;
  }
};

export const exportTourReportToExcel = (reportData: TourReportData, agencyName: string) => {
  const wb = XLSX.utils.book_new();

  const summaryData = [
    ['REPORTE DE ASISTENTES POR TOUR'],
    [''],
    ['Agencia:', agencyName],
    ['Tour:', reportData.tour.name],
    ['Destino:', reportData.tour.destination],
    ['Fecha del Tour:', `${formatDate(reportData.tour.start_date)} - ${formatDate(reportData.tour.end_date)}`],
    ['Fecha de Generación:', formatDate(new Date().toISOString())],
    [''],
    ['RESUMEN GENERAL'],
    ['Total de Reservas:', reportData.summary.totalBookings],
    ['Total de Viajeros:', reportData.summary.totalTravelers],
    [''],
    ['VIAJEROS POR CATEGORÍA'],
    ['Adultos:', reportData.summary.totalsByCategory.adultos],
    ['Niños:', reportData.summary.totalsByCategory.ninos],
    ['Infantes:', reportData.summary.totalsByCategory.infantes],
    ['Adultos Mayores:', reportData.summary.totalsByCategory.adultos_mayores],
    ['Mascotas:', reportData.summary.totalsByCategory.mascotas],
    [''],
    ['RESUMEN FINANCIERO'],
    ['Anticipo Total Recibido:', formatCurrency(reportData.summary.totalDeposit)],
    ['Saldo Pendiente Total:', formatCurrency(reportData.summary.totalRemaining)],
    ['Ingreso Total:', formatCurrency(reportData.summary.totalRevenue)],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen');

  const detailData: any[][] = [
    [
      'ID Reserva',
      'Cliente',
      'Email Cliente',
      'Teléfono Cliente',
      'Nombre Viajero',
      'Categoría',
      'Email Viajero',
      'Teléfono Viajero',
      'Precio Individual',
      'Anticipo Pagado',
      'Saldo Pendiente',
      'ToursRed Cash Usado',
      'Método de Pago',
      'Fecha Tour',
      'Fecha Reserva'
    ]
  ];

  reportData.bookings.forEach((booking) => {
    const clientName = `${booking.users.first_name} ${booking.users.last_name}`;
    const depositAmount = Number(booking.deposit_amount || 0);
    const totalPrice = Number(booking.total_price || 0);
    const remainingAmount = totalPrice - depositAmount;
    const toursRedCash = Number(booking.toursred_cash_used || 0);

    if (booking.travelers && booking.travelers.length > 0) {
      booking.travelers.forEach((traveler) => {
        detailData.push([
          booking.id.substring(0, 8),
          clientName,
          booking.users.email,
          booking.users.phone_number || 'N/A',
          traveler.nombre,
          getCategoryLabel(traveler.categoria_viajero),
          traveler.email,
          traveler.telefono || 'N/A',
          formatCurrency(Number(traveler.precio_aplicado || 0)),
          formatCurrency(depositAmount),
          formatCurrency(remainingAmount),
          formatCurrency(toursRedCash),
          booking.payment_method || 'N/A',
          formatDate(booking.booking_date),
          formatDate(booking.created_at)
        ]);
      });
    } else {
      detailData.push([
        booking.id.substring(0, 8),
        clientName,
        booking.users.email,
        booking.users.phone_number || 'N/A',
        'Sin acompañantes registrados',
        'N/A',
        'N/A',
        'N/A',
        'N/A',
        formatCurrency(depositAmount),
        formatCurrency(remainingAmount),
        formatCurrency(toursRedCash),
        booking.payment_method || 'N/A',
        formatDate(booking.booking_date),
        formatDate(booking.created_at)
      ]);
    }
  });

  const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
  wsDetail['!cols'] = [
    { wch: 12 }, { wch: 25 }, { wch: 30 }, { wch: 15 },
    { wch: 25 }, { wch: 15 }, { wch: 30 }, { wch: 15 },
    { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 18 },
    { wch: 15 }, { wch: 12 }, { wch: 12 }
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalle de Viajeros');

  const fileName = `Reporte_${reportData.tour.name.replace(/\s+/g, '_')}_${format(new Date(), 'ddMMyyyy')}.xlsx`;
  XLSX.writeFile(wb, fileName);
};

export const exportTourReportToPDF = (reportData: TourReportData, agencyName: string) => {
  const doc = new jsPDF('landscape');

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('REPORTE DE ASISTENTES POR TOUR', 15, 20);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Agencia: ${agencyName}`, 15, 30);
  doc.text(`Tour: ${reportData.tour.name}`, 15, 36);
  doc.text(`Destino: ${reportData.tour.destination}`, 15, 42);
  doc.text(`Fecha del Tour: ${formatDate(reportData.tour.start_date)} - ${formatDate(reportData.tour.end_date)}`, 15, 48);
  doc.text(`Fecha de Generación: ${formatDate(new Date().toISOString())}`, 15, 54);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Resumen General', 15, 65);

  const summaryTableData = [
    ['Total de Reservas', reportData.summary.totalBookings.toString()],
    ['Total de Viajeros', reportData.summary.totalTravelers.toString()],
    ['Adultos', reportData.summary.totalsByCategory.adultos.toString()],
    ['Niños', reportData.summary.totalsByCategory.ninos.toString()],
    ['Infantes', reportData.summary.totalsByCategory.infantes.toString()],
    ['Adultos Mayores', reportData.summary.totalsByCategory.adultos_mayores.toString()],
    ['Mascotas', reportData.summary.totalsByCategory.mascotas.toString()],
    ['Anticipo Total Recibido', formatCurrency(reportData.summary.totalDeposit)],
    ['Saldo Pendiente Total', formatCurrency(reportData.summary.totalRemaining)],
    ['Ingreso Total', formatCurrency(reportData.summary.totalRevenue)],
  ];

  autoTable(doc, {
    startY: 70,
    head: [['Concepto', 'Valor']],
    body: summaryTableData,
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 40, halign: 'right' }
    }
  });

  const finalY = (doc as any).lastAutoTable.finalY || 150;

  doc.addPage();
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Detalle de Viajeros por Reserva', 15, 20);

  const detailTableData: any[][] = [];

  reportData.bookings.forEach((booking) => {
    const clientName = `${booking.users.first_name} ${booking.users.last_name}`;
    const depositAmount = Number(booking.deposit_amount || 0);
    const totalPrice = Number(booking.total_price || 0);
    const remainingAmount = totalPrice - depositAmount;

    if (booking.travelers && booking.travelers.length > 0) {
      booking.travelers.forEach((traveler, index) => {
        detailTableData.push([
          index === 0 ? booking.id.substring(0, 8) : '',
          index === 0 ? clientName : '',
          traveler.nombre,
          getCategoryLabel(traveler.categoria_viajero),
          traveler.email,
          formatCurrency(Number(traveler.precio_aplicado || 0)),
          index === 0 ? formatCurrency(depositAmount) : '',
          index === 0 ? formatCurrency(remainingAmount) : '',
          index === 0 ? (booking.payment_method || 'N/A') : ''
        ]);
      });
      detailTableData.push([
        { content: '', colSpan: 9, styles: { fillColor: [240, 240, 240], minCellHeight: 2 } }
      ]);
    }
  });

  autoTable(doc, {
    startY: 25,
    head: [[
      'ID',
      'Cliente',
      'Viajero',
      'Categoría',
      'Email',
      'Precio',
      'Anticipo',
      'Pendiente',
      'Pago'
    ]],
    body: detailTableData,
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    styles: { fontSize: 7, cellPadding: 2 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 35 },
      2: { cellWidth: 35 },
      3: { cellWidth: 25 },
      4: { cellWidth: 45 },
      5: { cellWidth: 25, halign: 'right' },
      6: { cellWidth: 25, halign: 'right' },
      7: { cellWidth: 25, halign: 'right' },
      8: { cellWidth: 20 }
    }
  });

  const fileName = `Reporte_${reportData.tour.name.replace(/\s+/g, '_')}_${format(new Date(), 'ddMMyyyy')}.pdf`;
  doc.save(fileName);
};
