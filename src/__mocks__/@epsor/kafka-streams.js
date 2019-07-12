export const mockOn = jest.fn();
export const mockGetStream = jest.fn();

export default jest.fn().mockImplementation(() => {
  return {
    on: mockOn,
    getStream: mockGetStream,
  };
});
