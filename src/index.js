import logger from '@epsor/logger';

import app from './app';

const PORT = process.env.HEALTHCHECK_PORT || 8000;

(async () => {
  await app.listen(PORT, () => {
    logger.info(`consumer-wrapper listening at port ${PORT}`);
  });
})();

export { default as AbstractHandler } from './abstractHandler';
export { default as Consumer } from './consumer';
export { default as HandlerError } from './handlerError';
