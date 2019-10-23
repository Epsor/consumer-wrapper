import express from 'express';

const app = express();

app.get('/.well-known/express/server-health', (req, res) => {
  return res.status(200).json({ status: 'pass' });
});

export default app;
