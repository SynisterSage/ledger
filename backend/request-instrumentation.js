const isDevelopment = () => process.env.NODE_ENV !== 'production' && process.env.LEDGER_SUPABASE_TRACE !== '0';

const queryParts = (url) => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    return {
      table: segments.at(-1) || '(unknown)',
      selectedFields: parsed.searchParams.get('select') || '(default)',
    };
  } catch {
    return { table: '(unknown)', selectedFields: '(unknown)' };
  }
};

export const createSupabaseTraceFetch = (baseFetch = globalThis.fetch) => {
  const aggregates = new Map();

  return async (input, init) => {
    const request = new Request(input, init);
    const { table, selectedFields } = queryParts(request.url);
    const logicalQueryName = `${request.method} ${table} [${selectedFields}]`;
    const aggregate = aggregates.get(logicalQueryName) ?? {
      invocationCount: 0,
      returnedRowCount: 0,
      approximateResponseBytes: 0,
    };
    aggregate.invocationCount += 1;
    aggregates.set(logicalQueryName, aggregate);

    const response = await baseFetch(request);
    if (!isDevelopment()) return response;

    try {
      const body = await response.clone().text();
      aggregate.approximateResponseBytes += Buffer.byteLength(body, 'utf8');
      if (body) {
        const parsed = JSON.parse(body);
        aggregate.returnedRowCount += Array.isArray(parsed) ? parsed.length : parsed ? 1 : 0;
      }
    } catch {
      // Instrumentation must never affect the request path.
    }

    console.debug('[ledger:supabase]', {
      logicalQueryName,
      table,
      selectedFields,
      invocationCount: aggregate.invocationCount,
      returnedRowCount: aggregate.returnedRowCount,
      approximateResponseBytes: aggregate.approximateResponseBytes,
    });
    return response;
  };
};

