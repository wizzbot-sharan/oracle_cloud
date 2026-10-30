function safeBusyState(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[masked-email]')
    .replace(/\b\d{6,8}\b/g, '[masked-code]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function waitForOracleJetReady(page, { timeoutMs = 30000 } = {}) {
  return page.evaluate(async ({ timeoutMs: pageTimeoutMs }) => {
    const unavailable = { status: 'jet_unavailable', busy_states: [] };
    if (!window.oj?.Context?.getPageContext) return unavailable;

    let busyContext;
    try {
      busyContext = window.oj.Context.getPageContext().getBusyContext();
    } catch {
      return unavailable;
    }
    if (!busyContext?.whenReady) return unavailable;

    const states = () => {
      try {
        return (busyContext.getBusyStates?.() || []).map((item) => item.description || String(item));
      } catch {
        return [];
      }
    };

    try {
      const result = await busyContext.whenReady(pageTimeoutMs);
      return result === true
        ? { status: 'ready', busy_states: [] }
        : { status: 'timeout', busy_states: states() };
    } catch {
      return { status: 'timeout', busy_states: states() };
    }
  }, { timeoutMs }).then((result) => ({
    ...result,
    busy_states: result.busy_states.map(safeBusyState).filter(Boolean),
  })).catch(() => ({ status: 'guard_error', busy_states: [] }));
}

module.exports = { waitForOracleJetReady };
