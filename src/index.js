import logger from '@epsor/logger';

import app from './app';

const PORT = process.env.HEALTHCHECK_PORT;

(async () => {
  if (!PORT) {
    logger.info(`consumer port is not defined. HEALTHCHECK disabled`, { tags: ['consumer'] });
    return;
  }
  await app.listen(PORT, () => {
    logger.info(`consumer-wrapper listening`, { port: PORT, tags: ['consumer', 'health-check'] });
  });
})();

export { default as AbstractHandler } from './abstractHandler';
export { default as Consumer } from './consumer';
export { default as HandlerError } from './handlerError';
