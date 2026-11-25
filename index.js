// -----------------------------------------------------------------------------
// Entry point of the GPSLogger integration image.
//
// The same image runs two roles:
//   - the integration itself (default): talks to Gladys through the SDK;
//   - the local receiver (GPSLOGGER_ROLE=receiver, set by the manifest
//     `containers` field): the HTTP endpoint GPSLogger calls on the LAN. It
//     has no Gladys credentials, so the SDK must not even be instantiated.
// -----------------------------------------------------------------------------

if (process.env.GPSLOGGER_ROLE === 'receiver') {
  const { runReceiver } = await import('./src/receiver.js');
  runReceiver();
} else {
  const { GladysIntegration, logger } = await import('@gladysassistant/integration-sdk');
  const { registerHandlers } = await import('./src/app.js');

  // GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN and GLADYS_INTEGRATION_SELECTOR
  // are injected by the Gladys supervisor: the SDK reads them.
  const gladys = new GladysIntegration();
  const app = registerHandlers(gladys, { dataDir: process.env.DATA_DIR ?? '/data' });

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    app.stop();
  });

  logger.info('Starting the GPSLogger integration...');
  gladys.connect().catch((err) => {
    logger.error('Initial connection failed', err);
    process.exit(1);
  });
}
