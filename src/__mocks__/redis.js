export default {
  createClient: jest.fn(() => ({
    pub: jest.fn(),
  })),
};
