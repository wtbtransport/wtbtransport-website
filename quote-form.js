const form = document.getElementById('quote-form');

if (form) {
  const submitButton = form.querySelector('button[type="submit"]');
  const status = document.getElementById('quote-form-status');
  const fallbackMessage = 'We could not send your request right now. Please email info@wtbtransport.com or call (216) 762-7021.';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    form.setAttribute('aria-busy', 'true');
    status.dataset.state = 'pending';
    status.textContent = 'Sending your quote request...';

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof result.message === 'string' ? result.message : fallbackMessage);
      }

      status.dataset.state = 'success';
      status.textContent = result.message || 'Thanks. Your quote request has been sent to WTB Transport.';
      form.reset();
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error instanceof Error ? error.message : fallbackMessage;
    } finally {
      submitButton.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}
