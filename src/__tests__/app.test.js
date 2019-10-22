import request from 'supertest';

import app from '../app';

describe('App', () => {
  it('should respond to health check', async () => {
    const { text: body } = await request(app).get('/.well-known/express/server-health');

    expect(JSON.parse(body)).toEqual({ status: 'pass' });
  });
});
