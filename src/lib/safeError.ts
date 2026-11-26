/** Operational diagnostics must never serialize provider errors, headers or bodies. */
export function safeError(error: unknown) {
  const value = error && typeof error === 'object' ? error as { code?: unknown; status?: unknown } : {};
  const codes = ['23505', '23503', '23514', '42501', '22023', '40001', '40P01', '57014',
    'PGRST116', 'PGRST202', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'];
  return {
    code: typeof value.code === 'string' && codes.includes(value.code) ? value.code : 'operation_failed',
    ...(Number.isInteger(value.status) && Number(value.status) >= 400 && Number(value.status) <= 599
      ? { status: Number(value.status) } : {}),
  };
}
