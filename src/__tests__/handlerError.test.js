import HandlerError from '../handlerError';

describe('handlerError', () => {
  it('should extends Error', () => {
    expect(HandlerError.prototype instanceof Error).toBe(true);
  });

  it('should extends Error', () => {
    expect(HandlerError.prototype instanceof Error).toBe(true);
  });

  describe('setHandlerName', () => {
    it('should set HanlderName', () => {
      const error = new HandlerError();

      error.setHandlerName('coucou');

      expect(error.handlerName).toBe('coucou');
    });
    it('should returns this', () => {
      const error = new HandlerError();

      expect(error.setHandlerName('coucou')).toBe(error);
    });
  });
});
