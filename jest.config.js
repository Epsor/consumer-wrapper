const pack = require('./package');

module.exports = {
  coveragePathIgnorePatterns: ['node_modules', 'build', 'dist'],
  coverageReporters: ['json', 'text', 'html'],
  verbose: true,
  moduleFileExtensions: ['js'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/dist'],
  resetModules: false,
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.js$',
  roots: ['<rootDir>/src'],
  displayName: pack.name,
  name: pack.name,
  preset: '@shelf/jest-mongodb',
};
