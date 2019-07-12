import AbstractHandler from '../abstractHandler';

describe('AbstractHandler', () => {
  describe('handlerName', () => {
    it('should throw if not implemented', () => {
      expect(() => AbstractHandler.handlerName).toThrow();
    });
  });

  describe('allowedTypes', () => {
    it('should throw if not implemented', () => {
      expect(() => AbstractHandler.allowedTypes).toThrow();
    });
  });

  describe('allowedTypes', () => {
    it('should throw if not implemented', () => {
      expect(() => AbstractHandler.handle()).toThrow();
    });
  });
});
