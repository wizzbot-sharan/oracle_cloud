function safeBusyState(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[masked-email]')
    .replace(/\b\d{6,8}\b/g, '[masked-code]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

async function waitForOracleJetReady(page, { timeoutMs = 2000 } = {}) {
  const evaluatePromise = page.evaluate(async ({ timeoutMs: pageTimeoutMs }) => {
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
      let timer;
      const readyPromise = busyContext.whenReady().then((res) => {
        if (timer) clearTimeout(timer);
        return res === false
          ? { status: 'timeout', busy_states: states() }
          : { status: 'ready', busy_states: [] };
      }).catch(() => {
        if (timer) clearTimeout(timer);
        return { status: 'timeout', busy_states: states() };
      });

      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: 'timeout', busy_states: states() }), pageTimeoutMs);
      });

      return await Promise.race([readyPromise, timeoutPromise]);
    } catch {
      return { status: 'timeout', busy_states: states() };
    }
  }, { timeoutMs }).then((result) => ({
    ...result,
    busy_states: result.busy_states.map(safeBusyState).filter(Boolean),
  })).catch(() => ({ status: 'guard_error', busy_states: [] }));

  let nodeTimer;
  const nodeTimeoutPromise = new Promise((resolve) => {
    nodeTimer = setTimeout(() => resolve({ status: 'timeout', busy_states: [] }), timeoutMs + 500);
  });

  return Promise.race([
    evaluatePromise.finally(() => { if (nodeTimer) clearTimeout(nodeTimer); }),
    nodeTimeoutPromise,
  ]);
}

module.exports = { waitForOracleJetReady };
