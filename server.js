'use strict';

const express = require('express');
const path = require('path');
const { soratamafy } = require('./index.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Static frontend files
app.use('/view', express.static(path.join(__dirname, 'view')));
app.use(express.static(path.join(__dirname, 'view')));
app.use(express.static(__dirname));

// Soratama transformation endpoint
app.all('/soratamafy', soratamafy);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'reality-marble' });
});

app.listen(PORT, () => {
  console.log(`Reality Marble server listening on http://localhost:${PORT}...`);
});
