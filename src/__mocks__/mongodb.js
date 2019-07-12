module.exports = {
  MongoClient: {
    connect: jest.fn(() => ({
      db: jest.fn(() => ({
        collections: jest.fn(() => ['users']),
        createCollection: jest.fn(() => Promise.resolve()),
      })),
    })),
  },
};
