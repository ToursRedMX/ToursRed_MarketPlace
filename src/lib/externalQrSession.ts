// Keep check-in credentials in memory and remove them before telemetry initializes.
let pendingToken = '';
export function captureExternalQr(): void {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has('external-qr')) return;
  const raw = params.get('external-qr') ?? '';
  pendingToken = /^[a-f0-9]{64}$/i.test(raw) ? raw : '';
  params.delete('external-qr');
  const hash = params.toString();
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + (hash ? '#' + hash : ''));
}
export function pendingExternalQr(): string { return pendingToken; }
