const logger = {
  info: jest.fn(),
  error: jest.fn(),
};

module.exports = {
  default: logger,
  ...logger,
};
