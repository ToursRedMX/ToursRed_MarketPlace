import writeExcelFile from 'write-excel-file/browser';

export type ExcelSheet = {
  data: Array<Array<unknown>>;
  sheet: string;
  columns?: Array<{ width?: number }>;
};

/** Writes and downloads an XLSX workbook in the browser. */
export const downloadExcel = async (sheets: ExcelSheet[], fileName: string): Promise<void> => {
  await writeExcelFile(sheets as Parameters<typeof writeExcelFile>[0]).toFile(fileName);
};
