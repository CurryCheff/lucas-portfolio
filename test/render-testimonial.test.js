const test = require('node:test');
const assert = require('node:assert');
const {
  escapeHtml,
  renderTestimonialCard,
  renderTrack,
  spliceTestimonials,
  START_MARKER,
  END_MARKER,
} = require('../api/_lib/render-testimonial');

test('escapeHtml escapes & before < > " \' (order matters)', () => {
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escaping makes a literal marker string structurally impossible to inject', () => {
  const malicious = 'nice testimonial <!-- TESTIMONIALS:END --><script>evil()</script>';
  const rendered = renderTestimonialCard({ quote: malicious, author_name: 'X', author_role: 'Y' });
  assert.ok(!rendered.includes(END_MARKER));
  assert.ok(rendered.includes('&lt;!-- TESTIMONIALS:END --&gt;'));
});

test('spliceTestimonials fails closed when markers are missing', () => {
  assert.throws(() => spliceTestimonials('<html><body>no markers here</body></html>', 'x'), /markers not found/);
});

test('spliceTestimonials fails closed when a marker appears more than once', () => {
  const html = `${START_MARKER}${START_MARKER}${END_MARKER}`;
  assert.throws(() => spliceTestimonials(html, 'x'), /more than once/);
});

test('spliceTestimonials fails closed when END appears before START', () => {
  const html = `${END_MARKER}${START_MARKER}`;
  assert.throws(() => spliceTestimonials(html, 'x'), /appears before/);
});

test('spliceTestimonials replaces content between markers, leaving the rest untouched', () => {
  const html = `<div>before</div>\n${START_MARKER}\nold content\n${END_MARKER}\n<div>after</div>`;
  const result = spliceTestimonials(html, 'new content');
  assert.ok(result.includes('<div>before</div>'));
  assert.ok(result.includes('<div>after</div>'));
  assert.ok(result.includes('new content'));
  assert.ok(!result.includes('old content'));
});

test('renderTrack handles the batch case (3+ items), not just one', () => {
  const rows = [
    { quote: 'Great work', author_name: 'Alice A', author_role: 'CEO, Acme' },
    { quote: 'Loved it', author_name: 'Bob B', author_role: 'Founder, Beta Co' },
    { quote: 'Highly recommend', author_name: 'Carol C', author_role: 'CTO, Gamma' },
  ];
  const html = renderTrack(rows);
  const cardCount = (html.match(/class="testimonial"/g) || []).length;
  assert.equal(cardCount, 3);
  assert.ok(html.includes('Great work'));
  assert.ok(html.includes('Loved it'));
  assert.ok(html.includes('Highly recommend'));

  const spliced = spliceTestimonials(`${START_MARKER}${END_MARKER}`, html);
  assert.equal((spliced.match(/class="testimonial"/g) || []).length, 3);
});

test('initials are derived and escaped safely', () => {
  const card = renderTestimonialCard({ quote: 'q', author_name: '<b>Weird</b> Name', author_role: '' });
  assert.ok(!card.includes('<b>Weird</b>'));
});
