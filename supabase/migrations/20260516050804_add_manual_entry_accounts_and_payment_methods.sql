-- Cuentas de ingreso adicionales
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
VALUES
  ('406', '406', 'Ingresos por consultoria a agencias', 'ingreso', '4', 3, 'acreedora', false, true, 'Ingresos por servicios de consultoria prestados a agencias de viajes'),
  ('407', '407', 'Comisiones de mayoristas', 'ingreso', '4', 3, 'acreedora', false, true, 'Comisiones recibidas de mayoristas y operadores turisticos'),
  ('408', '408', 'Ingresos por paquetes de agencia de viajes', 'ingreso', '4', 3, 'acreedora', false, true, 'Ingresos por venta de paquetes turisticos como agencia de viajes'),
  ('409', '409', 'Otros ingresos varios', 'ingreso', '4', 3, 'acreedora', false, true, 'Ingresos varios no clasificados en otras cuentas')
ON CONFLICT (code) DO NOTHING;

-- Subcuentas de bancos / medios de pago
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
VALUES
  ('102.01', '102', 'Cuenta bancaria - Transferencia SPEI', 'activo', '102', 4, 'deudora', false, true, 'Movimientos a traves de transferencia electronica SPEI'),
  ('102.02', '102', 'Efectivo en caja', 'activo', '102', 4, 'deudora', false, true, 'Efectivo fisico en caja'),
  ('102.03', '102', 'Tarjeta de debito / credito - Terminal', 'activo', '102', 4, 'deudora', false, true, 'Cobros y pagos mediante terminal punto de venta')
ON CONFLICT (code) DO NOTHING;

-- Subcuentas de gasto detalladas bajo 601
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
VALUES
  ('601.01', '601', 'Gastos por servicios (internet, software, hosting)', 'gasto', '601', 4, 'deudora', false, true, 'Servicios de internet, licencias de software, hosting y similares'),
  ('601.02', '601', 'Gastos operativos (renta, papeleria, luz)', 'gasto', '601', 4, 'deudora', false, true, 'Gastos operativos generales: renta, servicios basicos, papeleria'),
  ('601.03', '601', 'Viaticos (hospedaje, transporte, alimentos)', 'gasto', '601', 4, 'deudora', false, true, 'Viaticos y gastos de representacion: hospedaje, transporte, alimentos'),
  ('601.04', '601', 'Otros gastos no clasificados', 'gasto', '601', 4, 'deudora', false, true, 'Gastos que no corresponden a ninguna categoria especifica')
ON CONFLICT (code) DO NOTHING;

-- Asegurar que la cuenta padre 102 exista (si no se creo en migraciones anteriores)
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
VALUES
  ('102', '102', 'Bancos y equivalentes', 'activo', '1', 3, 'deudora', false, true, 'Cuentas bancarias y equivalentes de efectivo')
ON CONFLICT (code) DO NOTHING;

-- Asegurar que la cuenta padre 601 exista
INSERT INTO chart_of_accounts (code, sat_group_code, name, account_type, parent_code, level, nature, is_system, is_active, description)
VALUES
  ('601', '601', 'Gastos de administracion', 'gasto', '6', 3, 'deudora', false, true, 'Gastos generales de administracion y operacion')
ON CONFLICT (code) DO NOTHING;
