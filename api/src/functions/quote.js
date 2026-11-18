const { app } = require('@azure/functions');
const { EmailClient } = require('@azure/communication-email');

const DEFAULT_RECIPIENT = 'info@wtbtransport.com';
const MAX_REQUEST_BYTES = 16 * 1024;
const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const FIELD_LIMITS = {
  name: 120,
  company: 120,
  email: 254,
  phone: 40,
  pickup: 180,
  delivery: 180,
  pickupDate: 10,
  equipment: 80,
  commodity: 180,
  weightDimensions: 160,
  details: 2000,
  website: 200
};
const UNAVAILABLE_MESSAGE = 'We could not send your request right now. Please email info@wtbtransport.com or call (216) 762-7021.';

let emailClient;
let emailClientConnectionString;

function responseFor(request, status, message) {
  const acceptsJson = request.headers.get('accept')?.includes('application/json');
  const headers = { 'Cache-Control': 'no-store' };

  if (acceptsJson) {
    return {
      status,
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ message })
    };
  }

  const title = status >= 400 ? 'Quote request could not be sent' : 'Quote request received';
  return {
    status,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | WTB Transport</title><link rel="stylesheet" href="/style.css"></head><body><main class="content-section"><div class="container content-narrow"><p class="eyebrow eyebrow-dark">REQUEST A QUOTE</p><h1>${title}</h1><p>${escapeHtml(message)}</p><a class="button button-red" href="/quote.html">Return to quote form</a></div></main></body></html>`
  };
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function readRequestBody(request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    return { error: { status: 413, message: 'Your request is too large. Please shorten the shipment details and try again.' } };
  }

  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' && contentType !== 'application/x-www-form-urlencoded') {
    return { error: { status: 415, message: 'Please submit the quote request form.' } };
  }

  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
    return { error: { status: 413, message: 'Your request is too large. Please shorten the shipment details and try again.' } };
  }

  if (contentType === 'application/x-www-form-urlencoded') {
    return { data: Object.fromEntries(new URLSearchParams(body)) };
  }

  try {
    return { data: JSON.parse(body) };
  } catch {
    return { error: { status: 400, message: 'Please check the form and try again.' } };
  }
}

function normalizeQuote(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Please check the form and try again.' };
  }

  const quote = {};
  for (const [field, maxLength] of Object.entries(FIELD_LIMITS)) {
    const value = input[field];
    if (value === undefined || value === null) {
      quote[field] = '';
      continue;
    }
    if (typeof value !== 'string') {
      return { error: 'Please check the form and try again.' };
    }

    quote[field] = value.trim();
    if (quote[field].length > maxLength) {
      return { error: 'One or more fields are too long. Please shorten them and try again.' };
    }
  }

  if (quote.website) {
    return { spam: true };
  }

  if (!quote.name || !quote.email || !quote.pickup || !quote.delivery || !quote.commodity) {
    return { error: 'Please complete your name, email, pickup location, delivery location, and freight details.' };
  }
  if (!EMAIL_PATTERN.test(quote.email)) {
    return { error: 'Please enter a valid email address.' };
  }
  if ([quote.name, quote.company, quote.phone].some((value) => /[\u0000-\u001f\u007f]/.test(value))) {
    return { error: 'Please check the contact details and try again.' };
  }
  if (quote.pickupDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(quote.pickupDate)) {
      return { error: 'Please enter a valid pickup date.' };
    }
    const pickupDate = new Date(`${quote.pickupDate}T00:00:00.000Z`);
    if (Number.isNaN(pickupDate.valueOf()) || pickupDate.toISOString().slice(0, 10) !== quote.pickupDate) {
      return { error: 'Please enter a valid pickup date.' };
    }
  }

  return { quote };
}

function buildEmail(quote, senderAddress, recipientAddress) {
  const lines = [
    'New quote request from the WTB Transport website',
    '',
    `Name: ${quote.name}`,
    quote.company && `Company: ${quote.company}`,
    `Email: ${quote.email}`,
    quote.phone && `Phone: ${quote.phone}`,
    `Pickup: ${quote.pickup}`,
    `Delivery: ${quote.delivery}`,
    quote.pickupDate && `Requested pickup date: ${quote.pickupDate}`,
    quote.equipment && `Equipment: ${quote.equipment}`,
    `Freight / commodity: ${quote.commodity}`,
    quote.weightDimensions && `Weight and dimensions: ${quote.weightDimensions}`,
    quote.details && `Additional details:\n${quote.details}`
  ].filter(Boolean);

  return {
    senderAddress,
    content: {
      subject: 'WTB Transport website quote request',
      plainText: lines.join('\n')
    },
    recipients: {
      to: [{ address: recipientAddress }]
    },
    replyTo: [{ address: quote.email, displayName: quote.name }]
  };
}

async function sendQuoteEmail(message, connectionString) {
  if (!emailClient || emailClientConnectionString !== connectionString) {
    emailClient = new EmailClient(connectionString);
    emailClientConnectionString = connectionString;
  }

  const poller = await emailClient.beginSend(message);
  const result = await poller.pollUntilDone();
  if (result.status !== 'Succeeded') {
    const error = new Error('Azure Communication Services did not accept the email.');
    error.name = 'EmailDeliveryError';
    throw error;
  }
}

async function handleQuoteRequest(request, context, options = {}) {
  let parsed;
  try {
    parsed = await readRequestBody(request);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    context.error(`Quote request body could not be read (${errorName}).`);
    return responseFor(request, 400, 'Please check the form and try again.');
  }
  if (parsed.error) {
    return responseFor(request, parsed.error.status, parsed.error.message);
  }

  const normalized = normalizeQuote(parsed.data);
  if (normalized.spam) {
    return responseFor(request, 202, 'Thanks. Your quote request has been sent to WTB Transport.');
  }
  if (normalized.error) {
    return responseFor(request, 400, normalized.error);
  }

  const env = options.env || process.env;
  const connectionString = env.ACS_CONNECTION_STRING;
  const senderAddress = env.ACS_SENDER_ADDRESS;
  const recipientAddress = env.QUOTE_TO_EMAIL?.trim() || DEFAULT_RECIPIENT;
  if (!connectionString || !senderAddress || !EMAIL_PATTERN.test(recipientAddress)) {
    context.error('Quote email delivery is missing valid Azure Communication Services settings.');
    return responseFor(request, 503, UNAVAILABLE_MESSAGE);
  }

  try {
    const message = buildEmail(normalized.quote, senderAddress, recipientAddress);
    const sendEmail = options.sendEmail || sendQuoteEmail;
    await sendEmail(message, connectionString);
    return responseFor(request, 202, 'Thanks. Your quote request has been sent to WTB Transport.');
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    context.error(`Quote email delivery failed (${errorName}).`);
    return responseFor(request, 502, UNAVAILABLE_MESSAGE);
  }
}

app.http('quote', {
  route: 'quote',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: handleQuoteRequest
});

module.exports = { handleQuoteRequest };
