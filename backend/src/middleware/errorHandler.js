const errorHandler = (err, req, res, next) => {
  console.error(err.message);
  if (err.code === 'P2002') return res.status(409).json({ error: 'Record already exists.' });
  if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found.' });
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
};
module.exports = { errorHandler };
