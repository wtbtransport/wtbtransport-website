const assert = require('node:assert/strict');
const { test } = require('node:test');
const { handleQuoteRequest } = require('../src/functions/quote');

const quote = {
  name: 'Sam Example',
  company: 'Example Co.',
  email: 'sam@example.com',
  phone: '216-555-0100',
  pickup: 'Cleveland, OH',
  delivery: 'Chicago, IL',
  pickupDate: '2026-12-01',
  equipment: 'Dry van',
  commodity: 'Palletized parts',
  weightDimensions: '12,000 lb',
  details: 'Call before delivery.'
};

const env = {
  ACS_CONNECTION_STRING: 'test-connection',
  ACS_SENDER_ADDRESS: 'quotes@example.com'
};

function createRequest(body, contentType = 'application/json', accept = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    headers: new Headers({
      Accept: accept,
      'Content-Length': String(Buffer.byteLength(text)),
      'Content-Type': contentType
    }),
    text: async () => text
  };
}

function createContext() {
  return { error() {} };
}

function responseMessage(response) {
  return JSON.parse(response.body).message;
}

test('sends valid quote details to the configured inbox and sets the reply address', async () => {
  let sentMessage;
  const response = await handleQuoteRequest(createRequest(quote), createContext(), {
    env,
    sendEmail: async (message) => {
      sentMessage = message;
    }
  });

  assert.equal(response.status, 202);
  assert.equal(sentMessage.recipients.to[0].address, 'info@wtbtransport.com');
  assert.deepEqual(sentMessage.replyTo, [{ address: 'sam@example.com', displayName: 'Sam Example' }]);
  assert.match(sentMessage.content.plainText, /Pickup: Cleveland, OH/);
  assert.match(sentMessage.content.plainText, /Additional details:\nCall before delivery\./);
});

test('rejects an invalid email without sending a message', async () => {
  let sent = false;
  const response = await handleQuoteRequest(
    createRequest({ ...quote, email: 'not-an-email' }),
    createContext(),
    { env, sendEmail: async () => { sent = true; } }
  );

  assert.equal(response.status, 400);
  assert.match(responseMessage(response), /valid email address/);
  assert.equal(sent, false);
});

test('rejects impossible pickup dates without sending a message', async () => {
  const response = await handleQuoteRequest(
    createRequest({ ...quote, pickupDate: '2026-02-31' }),
    createContext(),
    { env, sendEmail: async () => assert.fail('Invalid dates must not be sent.') }
  );

  assert.equal(response.status, 400);
  assert.match(responseMessage(response), /valid pickup date/);
});

test('silently accepts honeypot submissions without emailing', async () => {
  let sent = false;
  const response = await handleQuoteRequest(
    createRequest({ ...quote, website: 'filled by a bot' }),
    createContext(),
    { env, sendEmail: async () => { sent = true; } }
  );

  assert.equal(response.status, 202);
  assert.equal(sent, false);
});

test('supports standard form posts when JavaScript is unavailable', async () => {
  let sentMessage;
  const body = new URLSearchParams(quote).toString();
  const response = await handleQuoteRequest(
    createRequest(body, 'application/x-www-form-urlencoded', 'text/html'),
    createContext(),
    {
      env,
      sendEmail: async (message) => {
        sentMessage = message;
      }
    }
  );

  assert.equal(response.status, 202);
  assert.match(response.body, /Quote request received/);
  assert.match(sentMessage.content.plainText, /Freight \/ commodity: Palletized parts/);
});

test('reports unavailable when ACS settings are missing', async () => {
  const response = await handleQuoteRequest(createRequest(quote), createContext(), {
    env: {},
    sendEmail: async () => {
      assert.fail('Email delivery must not run without ACS settings.');
    }
  });

  assert.equal(response.status, 503);
  assert.match(responseMessage(response), /info@wtbtransport\.com/);
});
