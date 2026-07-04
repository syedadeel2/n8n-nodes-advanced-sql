/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/nodes', '<rootDir>/credentials'],
  testMatch: ['**/*.spec.ts'],
  collectCoverageFrom: ['nodes/**/*.ts', 'credentials/**/*.ts', '!**/*.spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};
