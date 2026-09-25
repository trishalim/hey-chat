for (const form of document.querySelectorAll('form')) {
  form.addEventListener('submit', event => {
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) { event.preventDefault(); return; }
    // Defer disabling to preserve the clicked submit button's name/value in the request.
    setTimeout(() => { for (const button of form.querySelectorAll('button[type="submit"]')) { button.disabled = true; button.setAttribute('aria-busy', 'true'); } }, 0);
  });
}
window.addEventListener('pageshow', () => {
  for (const button of document.querySelectorAll('button[aria-busy]')) { button.disabled = false; button.removeAttribute('aria-busy'); }
});
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const input = document.getElementById(button.dataset.copy);
    const status = document.getElementById('copy-status');
    try { await navigator.clipboard.writeText(input.value); status.textContent = 'Copied.'; }
    catch { input.focus(); input.select(); status.textContent = 'Select and copy the highlighted text.'; }
  });
}
const tester = document.getElementById('test-keyword');
if (tester) tester.addEventListener('click', async () => {
  const form = document.getElementById('automation-form');
  const result = document.getElementById('test-result');
  tester.disabled = true;
  result.textContent = 'Checking…';
  try {
    const response = await fetch('/admin/preview', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: form.elements._csrf.value, keywords: form.elements.keywords.value, comment: document.getElementById('test_comment').value }) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error();
    const data = await response.json();
    result.textContent = data.matches ? 'Match. This comment would trigger your DM when the automation is on.' : 'No match. This comment would not trigger a reply.';
  } catch { result.textContent = 'Could not check this comment. Reload the page and try again.'; }
  finally { tester.disabled = false; }
});
